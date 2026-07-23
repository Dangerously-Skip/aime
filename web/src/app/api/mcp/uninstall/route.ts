export const runtime = 'nodejs';

import { rm, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getMcpConfigPath, getMcpClientsPath } from '@/lib/app-paths';

const QUARRY_DIR = join(homedir(), '.claude');
const PLUGINS_DIR = join(QUARRY_DIR, 'plugins');
const MCP_CONFIG_FILE = getMcpConfigPath();
const MCP_CLIENTS_FILE = getMcpClientsPath();

/**
 * POST /api/mcp/uninstall
 * Body: { name }
 * Removes the installed plugin directory, its provisioned MCP entry,
 * and its registered OAuth client.
 */
export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    if (!name) {
      return Response.json({ error: 'Missing name' }, { status: 400 });
    }

    // Safety: prevent path traversal
    if (name.includes('/') || name.includes('..')) {
      return Response.json({ error: 'Invalid plugin name' }, { status: 400 });
    }

    // Remove plugin directory
    const pluginDir = join(PLUGINS_DIR, name);
    await rm(pluginDir, { recursive: true, force: true });

    // Remove from MCP config
    try {
      const config = JSON.parse(await readFile(MCP_CONFIG_FILE, 'utf-8'));
      if (config.mcpServers) {
        delete config.mcpServers[`nib-mcp-${name}`];
        delete config.mcpServers[`nib-connector-${name}`];
        await writeFile(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch {}

    // Remove from registered clients
    try {
      const clients = JSON.parse(await readFile(MCP_CLIENTS_FILE, 'utf-8'));
      delete clients[name];
      await writeFile(MCP_CLIENTS_FILE, JSON.stringify(clients, null, 2), 'utf-8');
    } catch {}

    return Response.json({ success: true });
  } catch (error) {
    console.error('[MCP Uninstall] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Uninstall failed' },
      { status: 500 }
    );
  }
}
