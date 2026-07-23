export const runtime = 'nodejs';

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getMcpConfigPath } from '@/lib/app-paths';

/**
 * MCP provisioner API route.
 * Manages connector entries in ~/.claude/.mcp.json
 */

const MCP_CONFIG_DIR = join(homedir(), '.claude');
const MCP_CONFIG_PATH = getMcpConfigPath();

/**
 * Resolve the directory the app's bundled MCP servers live in. Dev: web/.
 * Packaged app: process.resourcesPath (from electron-builder extraResources).
 * Used to substitute {quarryAppDir} placeholders in connector args.
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

function substituteArgs(args: string[] | undefined): string[] | undefined {
  if (!args) return args;
  const appDir = resolveAppDir();
  return args.map((a) => a.replace(/\{quarryAppDir\}/g, appDir));
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

async function readMcpConfig(): Promise<McpConfig> {
  try {
    const content = await readFile(MCP_CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { mcpServers: {} };
  }
}

async function writeMcpConfig(config: McpConfig): Promise<void> {
  await mkdir(MCP_CONFIG_DIR, { recursive: true });
  await writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * POST — Add/update a connector's MCP server entry
 */
export async function POST(request: Request) {
  try {
    const {
      connectorId,
      connectorName,
      mcpEntry,
      refreshToken,
      expiresAt,
      oauthClientId,
      oauthClientSecret,
      oauthTokenEndpoint,
    } = await request.json();

    if (!connectorId || !mcpEntry) {
      return Response.json({ error: 'Missing connectorId or mcpEntry' }, { status: 400 });
    }

    const config = await readMcpConfig();
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    const entryWithArgs = mcpEntry as { args?: string[] };
    const resolvedMcpEntry = {
      ...mcpEntry,
      ...(entryWithArgs.args ? { args: substituteArgs(entryWithArgs.args) } : {}),
    };

    // Use a prefixed key so we can identify our entries
    const serverKey = `nib-connector-${connectorId}`;
    config.mcpServers[serverKey] = {
      ...resolvedMcpEntry,
      _meta: {
        connectorId,
        connectorName,
        managedBy: 'nib-cowork',
        // Token refresh metadata — used by loadProvisionedMcpServers() to auto-refresh
        ...(refreshToken && { refreshToken }),
        ...(expiresAt && { expiresAt }),
        // For byoCredentials connectors, persist the user's OAuth client so
        // server-side refresh can run without them re-authenticating.
        ...(oauthClientId && { clientId: oauthClientId }),
        ...(oauthClientSecret && { clientSecret: oauthClientSecret }),
        ...(oauthTokenEndpoint && { tokenEndpoint: oauthTokenEndpoint }),
      },
    };

    await writeMcpConfig(config);

    return Response.json({ success: true, serverKey });
  } catch (error) {
    console.error('[Provisioner] POST error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to provision connector' },
      { status: 500 }
    );
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
    delete config.mcpServers[`nib-connector-${connectorId}`];
    delete config.mcpServers[`nib-mcp-${connectorId}`];

    await writeMcpConfig(config);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[Provisioner] DELETE error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to deprovision connector' },
      { status: 500 }
    );
  }
}
