export const runtime = 'nodejs';

import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getMcpConfigPath, getMcpClientsPath } from '@/lib/app-paths';

const QUARRY_DIR = join(homedir(), '.claude');
// Resolved per request, not at module load: Electron sets its paths after the
// server module is imported, so a captured constant can point at the wrong file.

/**
 * POST /api/mcp/oauth/exchange
 * Body: { mcpName, code, codeVerifier, redirectUri, tokenEndpoint, clientId }
 * Exchanges the auth code for tokens, then writes the authenticated MCP config
 * into the MCP config file with auto-refresh metadata.
 */
export async function POST(request: Request) {
  const mcpConfigFile = getMcpConfigPath();
  try {
    const { mcpName, code, codeVerifier, redirectUri, tokenEndpoint, clientId } =
      await request.json();

    if (!mcpName || !code || !codeVerifier || !redirectUri || !tokenEndpoint || !clientId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Load what we recorded at registration time.
    let clientSecret: string | undefined;
    let mcpUrl: string | undefined;
    let storedTokenEndpoint: string | undefined;
    try {
      const clients = JSON.parse(await readFile(getMcpClientsPath(), 'utf-8'));
      clientSecret = clients[mcpName]?.clientSecret;
      mcpUrl = clients[mcpName]?.mcpUrl;
      storedTokenEndpoint = clients[mcpName]?.tokenEndpoint;
    } catch {}

    if (!mcpUrl) {
      return Response.json({ error: 'No MCP URL registered for this plugin' }, { status: 400 });
    }

    // The authorization code and (for confidential clients) our client secret are
    // POSTed to this endpoint, so a caller-controlled value would be an
    // exfiltration channel. Prefer the endpoint we DISCOVERED and stored at
    // registration (RFC 8414) over anything the client sends — that closes the
    // gap P3.1 could only narrow to "must be https", because the stored value
    // came from the server's own metadata document rather than the request.
    const effectiveTokenEndpoint: string = storedTokenEndpoint ?? tokenEndpoint;
    if (typeof effectiveTokenEndpoint !== 'string' || !URL.canParse(effectiveTokenEndpoint)) {
      return Response.json({ error: 'Invalid tokenEndpoint' }, { status: 400 });
    }
    if (new URL(effectiveTokenEndpoint).protocol !== 'https:') {
      return Response.json({ error: 'tokenEndpoint must be https' }, { status: 400 });
    }
    if (storedTokenEndpoint && tokenEndpoint !== storedTokenEndpoint) {
      console.warn(
        `[MCP OAuth Exchange] Ignoring client tokenEndpoint for ${mcpName}; using the discovered one`,
      );
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

    const tokenRes = await fetch(effectiveTokenEndpoint, {
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

    // Write to the MCP config file with token + refresh metadata
    await mkdir(QUARRY_DIR, { recursive: true });

    let mcpConfig: { mcpServers?: Record<string, Record<string, unknown>> } = {};
    try {
      mcpConfig = JSON.parse(await readFile(mcpConfigFile, 'utf-8'));
    } catch {}

    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

    const expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined;

    // URLs ending in /sse use the legacy SSE MCP transport; everything else is streamable-http
    const isSse = typeof mcpUrl === 'string' && /\/sse\/?$/.test(mcpUrl);
    const transport = isSse ? 'sse' : 'streamable-http';

    const serverKey = `aime-mcp-${mcpName}`;
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
        // Needed for refresh: tokenEndpoint + clientId. The discovered value, so a
        // later refresh does not inherit a caller-supplied endpoint.
        tokenEndpoint: effectiveTokenEndpoint,
        clientId,
        ...(clientSecret && { clientSecret }),
      },
    };

    // Owner-only: this file now holds a live access token, a refresh token and
    // possibly a client secret. `mode` only applies on create, so chmod covers
    // configs written before this was enforced.
    await writeFile(mcpConfigFile, JSON.stringify(mcpConfig, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await chmod(mcpConfigFile, 0o600).catch(() => {});
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
