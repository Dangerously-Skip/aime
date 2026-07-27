export const runtime = 'nodejs';

import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { dirname } from 'path';
import { getMcpConfigPath } from '@/lib/app-paths';
import { decideProvision } from '@/lib/connectors/provision-guard';

/**
 * MCP provisioner API route — manages connector entries in the MCP config.
 *
 * The request supplies a connector id and its OAuth token; the *entry* is built
 * server-side from the connector registry (see provision-guard). The route
 * never accepts transport, command, args or url from the caller — those decide
 * what the agent executes.
 */

/**
 * Resolve the directory the app's bundled MCP servers live in. Dev: web/.
 * Packaged app: process.resourcesPath (from electron-builder extraResources).
 * Used to substitute {appDir} placeholders in connector args.
 */
function resolveAppDir(): string {
  // process.resourcesPath is set by Electron at runtime; the Node types don't
  // know about it, so we read through the process as a loose record.
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    // In packaged Electron, our mcp-servers are copied via extraResources.
    return resourcesPath;
  }
  return process.cwd();
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

async function readMcpConfig(): Promise<McpConfig> {
  try {
    const content = await readFile(getMcpConfigPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return { mcpServers: {} };
  }
}

/**
 * The config holds live access tokens, refresh tokens and client secrets, so it
 * is owner-only. `mode` on writeFile only applies when the file is created, so
 * the explicit chmod re-tightens configs written before this was enforced.
 *
 * The directory is derived from the config path rather than hardcoded, so it
 * cannot drift from getMcpConfigPath().
 */
async function writeMcpConfig(config: McpConfig): Promise<void> {
  const path = getMcpConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

/**
 * POST — Add/update a connector's MCP server entry.
 * Body: { connectorId, token, refreshToken?, expiresAt?, oauthClientId?,
 *         oauthClientSecret?, oauthTokenEndpoint? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const decision = decideProvision(body, { appDir: resolveAppDir() });
    if (!decision.ok) {
      return Response.json({ error: decision.error }, { status: 400 });
    }

    const config = await readMcpConfig();
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers[decision.serverKey] = {
      ...decision.entry,
      _meta: {
        connectorId: body.connectorId,
        connectorName: decision.connectorName,
        managedBy: 'aime',
        // Token refresh metadata — used by loadProvisionedMcpServers() to
        // auto-refresh. For byoCredentials connectors this includes the user's
        // own OAuth client so refresh runs without re-authenticating.
        ...decision.meta,
      },
    };

    await writeMcpConfig(config);

    return Response.json({ success: true, serverKey: decision.serverKey });
  } catch (error) {
    console.error('[Provisioner] POST error:', error);
    return Response.json({ error: 'Failed to provision connector' }, { status: 500 });
  }
}

/**
 * DELETE — Remove a connector's MCP server entry
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const connectorId = url.searchParams.get('connectorId');

    if (!connectorId) {
      return Response.json({ error: 'Missing connectorId parameter' }, { status: 400 });
    }

    const config = await readMcpConfig();
    if (!config.mcpServers) {
      return Response.json({ success: true });
    }

    // Remove both legacy and new MCP OAuth entry formats
    delete config.mcpServers[`aime-connector-${connectorId}`];
    delete config.mcpServers[`aime-mcp-${connectorId}`];
    // Legacy pre-rename prefixes
    delete config.mcpServers[`nib-connector-${connectorId}`];
    delete config.mcpServers[`nib-mcp-${connectorId}`];

    await writeMcpConfig(config);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[Provisioner] DELETE error:', error);
    return Response.json({ error: 'Failed to deprovision connector' }, { status: 500 });
  }
}
