import type { ConnectorDefinition } from './types';

/**
 * MCP Provisioner — manages connector entries in the MCP configuration.
 *
 * Swappable: replace with Babelfish's MCP multiplexer in the future.
 */

interface McpServerEntry {
  transport: 'stdio' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Build the MCP server entry for a connector definition with its auth token.
 */
function buildMcpEntry(connector: ConnectorDefinition, token: string): McpServerEntry {
  const { mcp } = connector;

  if (mcp.transport === 'stdio') {
    const entry: McpServerEntry = {
      transport: 'stdio',
      command: mcp.command,
      args: mcp.args,
    };

    // For aws_iam connectors, don't inject any token — let the MCP server
    // inherit credentials from the environment (~/.aws/credentials, AWS_PROFILE, etc.)
    if (mcp.tokenInjection.method === 'env' && token) {
      entry.env = { [mcp.tokenInjection.envVar]: token };
    }

    return entry;
  }

  // HTTP transport
  const entry: McpServerEntry = {
    transport: 'streamable-http',
    url: mcp.url,
  };

  if (mcp.tokenInjection.method === 'header') {
    const prefix = mcp.tokenInjection.prefix || '';
    entry.headers = { [mcp.tokenInjection.headerName]: `${prefix}${token}` };
  }

  return entry;
}

/**
 * Provision a connector — adds its MCP server entry to the configuration.
 * Calls the server-side API route which manages the .mcp.json file.
 */
export async function provisionConnector(
  connector: ConnectorDefinition,
  token: string
): Promise<void> {
  const mcpEntry = buildMcpEntry(connector, token);

  const response = await fetch('/api/connectors/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectorId: connector.id,
      connectorName: connector.name,
      mcpEntry,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to provision connector: ${response.status}`);
  }
}

/**
 * Deprovision a connector — removes its MCP server entry from the configuration.
 */
export async function deprovisionConnector(connectorId: string): Promise<void> {
  const response = await fetch(`/api/connectors/provision?connectorId=${encodeURIComponent(connectorId)}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to deprovision connector: ${response.status}`);
  }
}
