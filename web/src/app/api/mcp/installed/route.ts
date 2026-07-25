export const runtime = 'nodejs';

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getMcpConfigPath } from '@/lib/app-paths';

const QUARRY_DIR = join(homedir(), '.claude');
const PLUGINS_DIR = join(QUARRY_DIR, 'plugins');
const MCP_CONFIG_FILE = getMcpConfigPath();

export interface InstalledPlugin {
  name: string;
  description?: string;
  hasMcpOAuth: boolean;
  authenticated: boolean;
}

/**
 * GET /api/mcp/installed
 * Returns the list of installed plugins and their auth status.
 */
export async function GET() {
  try {
    const installed: InstalledPlugin[] = [];

    // Load MCP config to determine which plugins are authenticated
    const authenticatedMcps = new Set<string>();
    try {
      const config = JSON.parse(await readFile(MCP_CONFIG_FILE, 'utf-8'));
      for (const [key, entry] of Object.entries(config.mcpServers || {})) {
        const meta = (entry as Record<string, unknown>)._meta as
          | Record<string, unknown>
          | undefined;
        if (meta?.mcpName && typeof meta.mcpName === 'string') {
          authenticatedMcps.add(meta.mcpName);
        }
        void key;
      }
    } catch {}

    let entries: string[] = [];
    try {
      entries = await readdir(PLUGINS_DIR);
    } catch {
      return Response.json({ plugins: [] });
    }

    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const pluginDir = join(PLUGINS_DIR, name);
      const s = await stat(pluginDir).catch(() => null);
      if (!s?.isDirectory()) continue;

      let description: string | undefined;
      let hasMcpOAuth = false;

      // Read plugin.json for description
      try {
        const pluginJson = JSON.parse(
          await readFile(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8')
        );
        description = pluginJson.description;

        // Check if the plugin defines an HTTP MCP server (which needs OAuth)
        const mcpServers = await resolveMcpServers(pluginDir, pluginJson);
        hasMcpOAuth = Object.values(mcpServers).some(
          (s: Record<string, unknown>) => s.url && (s.type === 'http' || s.type === 'sse' || !s.type)
        );
      } catch {}

      installed.push({
        name,
        description,
        hasMcpOAuth,
        authenticated: authenticatedMcps.has(name),
      });
    }

    return Response.json({ plugins: installed });
  } catch (error) {
    console.error('[MCP Installed] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to list plugins' },
      { status: 500 }
    );
  }
}

async function resolveMcpServers(
  pluginDir: string,
  pluginJson: { mcpServers?: string | Record<string, unknown> }
): Promise<Record<string, Record<string, unknown>>> {
  if (typeof pluginJson.mcpServers === 'string') {
    try {
      const parsed = JSON.parse(
        await readFile(join(pluginDir, pluginJson.mcpServers), 'utf-8')
      );
      return parsed.mcpServers || {};
    } catch {
      return {};
    }
  }
  if (pluginJson.mcpServers && typeof pluginJson.mcpServers === 'object') {
    return pluginJson.mcpServers as Record<string, Record<string, unknown>>;
  }
  return {};
}
