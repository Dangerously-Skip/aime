export const runtime = 'nodejs';

import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const MCP_CONFIG_FILE = join(homedir(), '.claude', '.quarry-mcp.json');

/**
 * GET /api/connectors/hydrate
 * Returns the list of connector IDs that are currently provisioned in
 * ~/.claude/.quarry-mcp.json. The connector store reads this on startup
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
      // Fallback: derive from key prefix
      else if (key.startsWith('nib-mcp-')) {
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
