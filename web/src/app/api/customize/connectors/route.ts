import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';

const MCP_JSON_PATH = path.join(os.homedir(), '.claude', '.mcp.json');

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
      const raw = fs.readFileSync(MCP_JSON_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[Connectors] Error reading .mcp.json:', err);
  }
  return { mcpServers: {} };
}

function writeMcpJson(data: McpJson) {
  const dir = path.dirname(MCP_JSON_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

interface ConnectorEntry {
  id: string;
  name: string;
  type: string;
  config: McpServerConfig;
  source: 'mcp_json' | 'composio';
  disabled: boolean;
}

/**
 * GET /api/customize/connectors — List all MCP server configs
 */
export async function GET() {
  const mcpData = readMcpJson();
  const connectors: ConnectorEntry[] = [];

  // Add Composio as a special entry if configured
  if (process.env.COMPOSIO_API_KEY) {
    connectors.push({
      id: '__composio__',
      name: 'Composio Tool Router',
      type: 'http',
      config: { type: 'http' },
      source: 'composio',
      disabled: false,
    });
  }

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
  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (!config) {
    return Response.json({ error: 'config is required' }, { status: 400 });
  }

  const mcpData = readMcpJson();
  if (!mcpData.mcpServers) mcpData.mcpServers = {};

  if (mcpData.mcpServers[name]) {
    return Response.json({ error: 'Connector already exists' }, { status: 409 });
  }

  const serverConfig: McpServerConfig = {
    type: (config.type as McpServerConfig['type']) || 'stdio',
    ...(config.command && { command: config.command }),
    ...(config.args && { args: config.args }),
    ...(config.url && { url: config.url }),
    ...(config.headers && { headers: config.headers }),
    ...(config.env && { env: config.env }),
  };

  mcpData.mcpServers[name] = serverConfig;
  writeMcpJson(mcpData);

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
