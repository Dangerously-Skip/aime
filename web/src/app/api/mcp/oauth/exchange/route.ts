export const runtime = 'nodejs';

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const QUARRY_DIR = join(homedir(), '.claude');
const MCP_CONFIG_FILE = join(QUARRY_DIR, '.quarry-mcp.json');
const MCP_CLIENTS_FILE = join(QUARRY_DIR, '.quarry-mcp-clients.json');

/**
 * POST /api/mcp/oauth/exchange
 * Body: { mcpName, code, codeVerifier, redirectUri, tokenEndpoint, clientId }
 * Exchanges the auth code for tokens, then writes the authenticated MCP config
 * into .quarry-mcp.json with auto-refresh metadata.
 */
export async function POST(request: Request) {
  try {
    const { mcpName, code, codeVerifier, redirectUri, tokenEndpoint, clientId } =
      await request.json();

    if (!mcpName || !code || !codeVerifier || !redirectUri || !tokenEndpoint || !clientId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Load client credentials (for client_secret if it's a confidential client)
    let clientSecret: string | undefined;
    let mcpUrl: string | undefined;
    try {
      const clients = JSON.parse(await readFile(MCP_CLIENTS_FILE, 'utf-8'));
      clientSecret = clients[mcpName]?.clientSecret;
      mcpUrl = clients[mcpName]?.mcpUrl;
    } catch {}

    if (!mcpUrl) {
      return Response.json({ error: 'No MCP URL registered for this plugin' }, { status: 400 });
    }

    // Exchange the code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });
    if (clientSecret) {
      tokenParams.set('client_secret', clientSecret);
    }

    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error(`[MCP OAuth Exchange] Failed for ${mcpName}:`, errorText);
      return Response.json(
        { error: `Token exchange failed: ${tokenRes.status} ${errorText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return Response.json({ error: 'No access token in response' }, { status: 502 });
    }

    // Write to .quarry-mcp.json with token + refresh metadata
    await mkdir(QUARRY_DIR, { recursive: true });

    let mcpConfig: { mcpServers?: Record<string, Record<string, unknown>> } = {};
    try {
      mcpConfig = JSON.parse(await readFile(MCP_CONFIG_FILE, 'utf-8'));
    } catch {}

    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

    const expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined;

    // URLs ending in /sse use the legacy SSE MCP transport; everything else is streamable-http
    const isSse = typeof mcpUrl === 'string' && /\/sse\/?$/.test(mcpUrl);
    const transport = isSse ? 'sse' : 'streamable-http';

    const serverKey = `nib-mcp-${mcpName}`;
    mcpConfig.mcpServers[serverKey] = {
      transport, // Gets translated to 'sse' or 'http' for the SDK
      url: mcpUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      _meta: {
        mcpName,
        managedBy: 'quarry-mcp-oauth',
        // Used by loadProvisionedMcpServers() for auto-refresh
        ...(tokenData.refresh_token && { refreshToken: tokenData.refresh_token }),
        ...(expiresAt && { expiresAt }),
        // Needed for refresh: tokenEndpoint + clientId
        tokenEndpoint,
        clientId,
        ...(clientSecret && { clientSecret }),
      },
    };

    await writeFile(MCP_CONFIG_FILE, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    console.log(`[MCP OAuth Exchange] Provisioned ${mcpName} at ${serverKey}`);

    return Response.json({
      accessToken,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type || 'Bearer',
      scope: tokenData.scope,
    });
  } catch (error) {
    console.error('[MCP OAuth Exchange] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Token exchange failed' },
      { status: 500 }
    );
  }
}
