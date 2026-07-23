export const runtime = 'nodejs';

import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getMcpConfigPath } from '@/lib/app-paths';

const MCP_CONFIG_FILE = getMcpConfigPath();

/**
 * GET /api/connectors/hydrate
 * Returns the list of connector IDs that are currently provisioned in
 * the provisioned MCP config (see app-paths). The connector store reads this on startup
 * to reflect state from other surfaces (e.g. marketplace installs,
 * CLI-written configs) in the Connectors UI.
 */
export async function GET() {
  try {
    const raw = await readFile(MCP_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw) as {
      mcpServers?: Record<string, { _meta?: Record<string, unknown> }>;
    };

    const ids: string[] = [];
    for (const [key, entry] of Object.entries(config.mcpServers || {})) {
      const meta = entry._meta;
      // Marketplace-installed MCP OAuth: _meta.mcpName
      if (meta?.mcpName && typeof meta.mcpName === 'string') {
        ids.push(meta.mcpName);
      }
      // Connectors page legacy: _meta.connectorId
      else if (meta?.connectorId && typeof meta.connectorId === 'string') {
        ids.push(meta.connectorId);
      }
      // Fallback: derive from key prefix (aime-* current, nib-* legacy)
      else if (key.startsWith('aime-mcp-')) {
        ids.push(key.replace('aime-mcp-', ''));
      } else if (key.startsWith('aime-connector-')) {
        ids.push(key.replace('aime-connector-', ''));
      } else if (key.startsWith('nib-mcp-')) {
        ids.push(key.replace('nib-mcp-', ''));
      } else if (key.startsWith('nib-connector-')) {
        ids.push(key.replace('nib-connector-', ''));
      }
    }

    return Response.json({ connectedIds: ids });
  } catch {
    return Response.json({ connectedIds: [] });
  }
}
