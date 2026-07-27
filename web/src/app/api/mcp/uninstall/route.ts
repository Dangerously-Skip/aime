export const runtime = 'nodejs';

import { rm, readFile, writeFile, chmod } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getMcpConfigPath, getMcpClientsPath } from '@/lib/app-paths';
import { sanitizePluginName, resolveInstallDir } from '@/lib/mcp/install-guard';

/** Both files hold live tokens and client secrets — owner-only. */
async function writeSecret(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { name } = body as { name?: unknown };

    // Same allowlist the install route uses — this path is passed to a
    // recursive rm, so it must be a single safe segment inside PLUGINS_DIR.
    const safeName = sanitizePluginName(name);
    if (!safeName.ok) {
      return Response.json({ error: safeName.error }, { status: 400 });
    }
    const pluginDir = resolveInstallDir(PLUGINS_DIR, safeName.value);
    if (!pluginDir.ok) {
      return Response.json({ error: pluginDir.error }, { status: 400 });
    }
    await rm(pluginDir.value, { recursive: true, force: true });

    // Remove from MCP config
    try {
      const config = JSON.parse(await readFile(MCP_CONFIG_FILE, 'utf-8'));
      if (config.mcpServers) {
        delete config.mcpServers[`aime-mcp-${safeName.value}`];
        delete config.mcpServers[`aime-connector-${safeName.value}`];
        // Legacy pre-rename prefixes
        delete config.mcpServers[`nib-mcp-${safeName.value}`];
        delete config.mcpServers[`nib-connector-${safeName.value}`];
        await writeSecret(MCP_CONFIG_FILE, config);
      }
    } catch {}

    // Remove from registered clients
    try {
      const clients = JSON.parse(await readFile(MCP_CLIENTS_FILE, 'utf-8'));
      delete clients[safeName.value];
      await writeSecret(MCP_CLIENTS_FILE, clients);
    } catch {}

    return Response.json({ success: true });
  } catch (error) {
    console.error('[MCP Uninstall] Error:', error);
    return Response.json({ error: 'Uninstall failed' }, { status: 500 });
  }
}
