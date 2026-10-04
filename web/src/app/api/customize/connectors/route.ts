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

// A server name becomes an object key in the config; refuse the ones that
// would reach Object.prototype instead of the map.
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function isValidServerName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    name.length <= 128 &&
    !RESERVED_NAMES.has(name) &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

interface ConnectorEntry {
  id: string;
  name: string;
  type: string;
  config: McpServerConfig;
  source: 'mcp_json';
  disabled: boolean;
}

/**
 * GET /api/customize/connectors — List all MCP server configs
 */
export async function GET() {
  const mcpData = (await readMcpConfig()) as McpJson;
  const connectors: ConnectorEntry[] = [];

  // Add user-configured MCP servers
  const servers = mcpData.mcpServers || {};
  for (const [name, config] of Object.entries(servers)) {
    connectors.push({
      id: name,
      name,
      type: config.type || 'stdio',
      config,
      source: 'mcp_json',
      disabled: config.disabled || false,
    });
  }

  return Response.json({ connectors });
}

/**
 * POST /api/customize/connectors — Add a new MCP server
 * Body: { name, type, config }
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; type?: string; config?: Partial<McpServerConfig> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, config } = body;
  if (!isValidServerName(name)) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (!config) {
    return Response.json({ error: 'config is required' }, { status: 400 });
  }

  const serverConfig: McpServerConfig = {
    type: (config.type as McpServerConfig['type']) || 'stdio',
    ...(config.command && { command: config.command }),
    ...(config.args && { args: config.args }),
    ...(config.url && { url: config.url }),
    ...(config.headers && { headers: config.headers }),
    ...(config.env && { env: config.env }),
  };

  let added: boolean | undefined;
  try {
    added = await updateMcpConfig((mcpData) => {
      if (!mcpData.mcpServers) mcpData.mcpServers = {};
      if (Object.hasOwn(mcpData.mcpServers, name)) return SKIP_WRITE;
      mcpData.mcpServers[name] = { ...serverConfig };
      return true;
    });
  } catch (err) {
    if (err instanceof McpConfigCorruptError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    console.error('[Connectors] Error writing MCP config:', err);
    return Response.json({ error: 'Failed to save connector' }, { status: 500 });
  }
  if (!added) {
    return Response.json({ error: 'Connector already exists' }, { status: 409 });
  }

  return Response.json({
    connector: {
      id: name,
      name,
      type: serverConfig.type,
      config: serverConfig,
      source: 'mcp_json',
      disabled: false,
    },
  }, { status: 201 });
}
