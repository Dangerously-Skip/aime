export const runtime = 'nodejs';

import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { discoverMcpOAuth, registerOAuthClient } from '@/lib/mcp/oauth-discovery';
import { sanitizePluginName } from '@/lib/mcp/install-guard';
import { validateMcpServerUrl } from '@/lib/mcp/url-guard';
import { getMcpClientsPath } from '@/lib/app-paths';
import { APP_NAME } from '@/config/branding';

const QUARRY_DIR = join(homedir(), '.claude');

interface StoredClient {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopes: string[];
  mcpUrl: string;
  redirectUri: string;
  registeredAt: number;
}

async function readClients(): Promise<Record<string, StoredClient>> {
  try {
    const content = await readFile(getMcpClientsPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeClients(clients: Record<string, StoredClient>) {
  await mkdir(QUARRY_DIR, { recursive: true });
  // Owner-only: this file holds OAuth client secrets. It was writing 0644 while
  // every sibling path (provision, exchange, uninstall) used 0600 — so the same
  // secret was AES-encrypted in one place and world-readable here.
  const clientsPath = getMcpClientsPath();
  await writeFile(clientsPath, JSON.stringify(clients, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(clientsPath, 0o600).catch(() => {});
}

interface PluginMcpHint {
  url: string;
  /** Pre-registered OAuth client_id the plugin author supplied — used when DCR isn't supported. */
  oauthClientId?: string;
}

function pickHttpServer(mcpServers: unknown): PluginMcpHint | null {
  if (!mcpServers || typeof mcpServers !== 'object') return null;
  for (const server of Object.values(mcpServers as Record<string, unknown>)) {
    if (!server || typeof server !== 'object') continue;
    const s = server as { url?: string; oauth?: { clientId?: string } };
    if (s.url) {
      return { url: s.url, oauthClientId: s.oauth?.clientId };
    }
  }
  return null;
}

function getMcpHintFromPlugin(pluginDir: string): Promise<PluginMcpHint | null> {
  return (async () => {
    try {
      // Try plugin.json first
      try {
        const pluginJson = JSON.parse(
          await readFile(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8')
        );
        if (typeof pluginJson.mcpServers === 'string') {
          const mcpConfig = JSON.parse(
            await readFile(join(pluginDir, pluginJson.mcpServers), 'utf-8')
          );
          const hit = pickHttpServer(mcpConfig.mcpServers);
          if (hit) return hit;
        } else if (pluginJson.mcpServers) {
          const hit = pickHttpServer(pluginJson.mcpServers);
          if (hit) return hit;
        }
      } catch {}

      // Fallback: top-level .mcp.json
      const mcpConfig = JSON.parse(
        await readFile(join(pluginDir, '.mcp.json'), 'utf-8')
      );
      return pickHttpServer(mcpConfig.mcpServers);
    } catch {}
    return null;
  })();
}

/**
 * POST /api/mcp/oauth/setup
 * Body: { mcpName, mcpUrl? }
 * Performs OAuth discovery + Dynamic Client Registration for a named MCP.
 *
 * Two invocation modes:
 * 1. Marketplace plugin — pass `mcpName` only; we read the URL from the installed plugin
 * 2. Built-in connector — pass both `mcpName` and `mcpUrl` directly (no plugin install needed)
 *
 * Returns the endpoints and client_id needed to start the browser OAuth flow.
 */
export async function POST(request: Request) {
  try {
    const { mcpName: rawName, mcpUrl: directUrl, fallbackClientId: directClientId, fallbackClientIdEnv } = await request.json();

    // mcpName becomes a directory lookup under ~/.claude/plugins and the key for
    // both the clients file and the provisioned MCP entry, so it gets the same
    // single-safe-segment allowlist the install route uses (P3.6).
    const safeName = sanitizePluginName(rawName);
    if (!safeName.ok) {
      return Response.json({ error: safeName.error }, { status: 400 });
    }
    const mcpName = safeName.value;

    // A caller-supplied URL is fetched server-side during discovery and then
    // persisted for the agent to connect to — unvalidated, that is an SSRF
    // primitive (see url-guard).
    if (directUrl !== undefined && directUrl !== null && directUrl !== '') {
      const verdict = validateMcpServerUrl(directUrl);
      if (!verdict.ok) {
        return Response.json({ error: verdict.message }, { status: 400 });
      }
    }

    // Resolve fallback client ID: direct param > env var > plugin manifest hint.
    const envFallbackClientId =
      fallbackClientIdEnv && typeof fallbackClientIdEnv === 'string'
        ? process.env[fallbackClientIdEnv]
        : undefined;

    let mcpUrl: string | null = directUrl || null;
    let pluginClientIdHint: string | undefined;
    if (!mcpUrl) {
      const pluginDir = join(QUARRY_DIR, 'plugins', mcpName);
      const hint = await getMcpHintFromPlugin(pluginDir);
      if (hint) {
        mcpUrl = hint.url;
        pluginClientIdHint = hint.oauthClientId;
      }
    }

    if (!mcpUrl) {
      return Response.json(
        { error: `No MCP server URL found for "${mcpName}". Pass mcpUrl directly or install the plugin first.` },
        { status: 404 }
      );
    }

    const fallbackClientId = directClientId || envFallbackClientId || pluginClientIdHint;

    // Reuse existing registration if we have one for this MCP
    const clients = await readClients();
    const existing = clients[mcpName];
    if (existing) {
      console.log(`[MCP OAuth Setup] Reusing existing client for ${mcpName}`);
      return Response.json({
        authorizationEndpoint: existing.authorizationEndpoint,
        tokenEndpoint: existing.tokenEndpoint,
        clientId: existing.clientId,
        scopes: existing.scopes,
        redirectUri: existing.redirectUri,
      });
    }

    // Discover OAuth metadata
    console.log(`[MCP OAuth Setup] Discovering OAuth for ${mcpUrl}`);
    const { resourceMetadata, serverMetadata } = await discoverMcpOAuth(mcpUrl);

    // Determine redirect URI (must match what Electron's auth window will catch)
    // We use http://localhost:3000 since Electron intercepts the redirect before it hits any real server
    const redirectUri = 'http://localhost:3000/api/connectors/oauth/callback';

    // Try Dynamic Client Registration. If the server doesn't support DCR,
    // fall back to a caller-provided pre-registered client_id (e.g. Microsoft MCPs
    // require a pre-registered Azure AD app).
    let clientId: string;
    let clientSecret: string | undefined;

    if (serverMetadata.registration_endpoint) {
      const client = await registerOAuthClient(serverMetadata, redirectUri, APP_NAME);
      clientId = client.client_id;
      clientSecret = client.client_secret;
      console.log(`[MCP OAuth Setup] Registered client ${clientId} for ${mcpName}`);
    } else if (fallbackClientId) {
      clientId = fallbackClientId;
      console.log(`[MCP OAuth Setup] Using fallback client_id ${clientId} for ${mcpName} (no DCR)`);
    } else {
      return Response.json(
        {
          error:
            `This MCP server does not support Dynamic Client Registration. ` +
            `An OAuth app must be pre-registered with the provider, and its client_id passed as fallbackClientId.`,
        },
        { status: 400 }
      );
    }

    // Determine scopes — prefer resource metadata, fall back to server metadata, fall back to empty
    const scopes =
      resourceMetadata?.scopes_supported ??
      serverMetadata.scopes_supported ??
      [];

    // Store the registration for future reuse
    const stored: StoredClient = {
      clientId,
      clientSecret,
      authorizationEndpoint: serverMetadata.authorization_endpoint,
      tokenEndpoint: serverMetadata.token_endpoint,
      registrationEndpoint: serverMetadata.registration_endpoint,
      scopes,
      mcpUrl,
      redirectUri,
      registeredAt: Date.now(),
    };
    clients[mcpName] = stored;
    await writeClients(clients);

    return Response.json({
      authorizationEndpoint: stored.authorizationEndpoint,
      tokenEndpoint: stored.tokenEndpoint,
      clientId: stored.clientId,
      scopes: stored.scopes,
      redirectUri: stored.redirectUri,
    });
  } catch (error) {
    console.error('[MCP OAuth Setup] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'OAuth setup failed' },
      { status: 500 }
    );
  }
}
