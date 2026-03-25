import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

const MCP_JSON_PATH = path.join(os.homedir(), '.claude', '.quarry-mcp.json');

interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  disabled?: boolean;
}

interface McpJson {
  mcpServers?: Record<string, McpServerConfig>;
}

function readMcpJson(): McpJson {
  try {
    if (fs.existsSync(MCP_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(MCP_JSON_PATH, 'utf-8'));
    }
  } catch {}
  return { mcpServers: {} };
}

function writeMcpJson(data: McpJson) {
  fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * GET /api/customize/connectors/:connectorId — Read a single connector
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  const mcpData = readMcpJson();
  const config = mcpData.mcpServers?.[connectorId];

  if (!config) {
    return Response.json({ error: 'Connector not found' }, { status: 404 });
  }

  return Response.json({
    connector: {
      id: connectorId,
      name: connectorId,
      type: config.type || 'stdio',
      config,
      source: 'mcp_json',
      disabled: config.disabled || false,
    },
  });
}

/**
 * PUT /api/customize/connectors/:connectorId — Update a connector
 * Body: { config?, disabled? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;

  let body: { config?: Partial<McpServerConfig>; disabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mcpData = readMcpJson();
  if (!mcpData.mcpServers?.[connectorId]) {
    return Response.json({ error: 'Connector not found' }, { status: 404 });
  }

  const existing = mcpData.mcpServers[connectorId];
  const updated: McpServerConfig = {
    ...existing,
    ...(body.config || {}),
    ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
  };

  mcpData.mcpServers[connectorId] = updated;
  writeMcpJson(mcpData);

  return Response.json({
    connector: {
      id: connectorId,
      name: connectorId,
      type: updated.type || 'stdio',
      config: updated,
      source: 'mcp_json',
      disabled: updated.disabled || false,
    },
  });
}

/**
 * DELETE /api/customize/connectors/:connectorId — Remove a connector
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  const mcpData = readMcpJson();

  if (!mcpData.mcpServers?.[connectorId]) {
    return Response.json({ error: 'Connector not found' }, { status: 404 });
  }

  delete mcpData.mcpServers[connectorId];
  writeMcpJson(mcpData);

  return Response.json({ deleted: true });
}
