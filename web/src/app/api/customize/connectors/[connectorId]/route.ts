import { NextRequest } from 'next/server';
import {
  readMcpConfig,
  updateMcpConfig,
  SKIP_WRITE,
  McpConfigCorruptError,
} from '@/lib/mcp/config-store';

export const runtime = 'nodejs';

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

function writeErrorResponse(err: unknown): Response {
  if (err instanceof McpConfigCorruptError) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  console.error('[Connectors] Error writing MCP config:', err);
  return Response.json({ error: 'Failed to save connector' }, { status: 500 });
}

const hasServer = (data: McpJson, id: string): boolean =>
  !!data.mcpServers && Object.hasOwn(data.mcpServers, id);

/**
 * GET /api/customize/connectors/:connectorId — Read a single connector
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  const mcpData = (await readMcpConfig()) as McpJson;
  const config = hasServer(mcpData, connectorId) ? mcpData.mcpServers![connectorId] : undefined;

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

  let updated: McpServerConfig | undefined;
  try {
    updated = await updateMcpConfig((raw) => {
      const mcpData = raw as McpJson;
      if (!hasServer(mcpData, connectorId)) return SKIP_WRITE;
      const next: McpServerConfig = {
        ...mcpData.mcpServers![connectorId],
        ...(body.config || {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
      };
      mcpData.mcpServers![connectorId] = next;
      return next;
    });
  } catch (err) {
    return writeErrorResponse(err);
  }
  if (!updated) {
    return Response.json({ error: 'Connector not found' }, { status: 404 });
  }

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

  let deleted: boolean | undefined;
  try {
    deleted = await updateMcpConfig((raw) => {
      const mcpData = raw as McpJson;
      if (!hasServer(mcpData, connectorId)) return SKIP_WRITE;
      delete mcpData.mcpServers![connectorId];
      return true;
    });
  } catch (err) {
    return writeErrorResponse(err);
  }
  if (!deleted) {
    return Response.json({ error: 'Connector not found' }, { status: 404 });
  }

  return Response.json({ deleted: true });
}
