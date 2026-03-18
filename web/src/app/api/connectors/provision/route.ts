export const runtime = 'nodejs';

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

/**
 * MCP provisioner API route.
 * Manages connector entries in ~/.claude/.mcp.json
 */

const MCP_CONFIG_DIR = join(homedir(), '.claude');
const MCP_CONFIG_PATH = join(MCP_CONFIG_DIR, '.mcp.json');

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
    const { connectorId, connectorName, mcpEntry } = await request.json();

    if (!connectorId || !mcpEntry) {
      return Response.json({ error: 'Missing connectorId or mcpEntry' }, { status: 400 });
    }

    const config = await readMcpConfig();
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Use a prefixed key so we can identify our entries
    const serverKey = `nib-connector-${connectorId}`;
    config.mcpServers[serverKey] = {
      ...mcpEntry,
      _meta: { connectorId, connectorName, managedBy: 'nib-cowork' },
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

    const serverKey = `nib-connector-${connectorId}`;
    delete config.mcpServers[serverKey];

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
