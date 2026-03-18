/**
 * Bridge between Nango OAuth connections and MCP server configurations.
 *
 * Once a user connects a service via Nango, this module can build MCP server
 * configs that use the stored OAuth tokens to provide authenticated tools
 * to Claude. This is a follow-up iteration — the immediate goal is the
 * OAuth catalog UI and connection flow.
 */

export interface McpServerConfig {
  type: 'http' | 'sse' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
}

export async function buildNangoMcpServers(): Promise<Record<string, McpServerConfig>> {
  const serverUrl = process.env.NANGO_SERVER_URL;
  const secretKey = process.env.NANGO_SECRET_KEY;

  if (!serverUrl || !secretKey) {
    return {};
  }

  try {
    const res = await fetch(`${serverUrl}/connections`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!res.ok) return {};

    const { connections } = await res.json();
    const servers: Record<string, McpServerConfig> = {};

    for (const conn of connections) {
      // Each connected integration could map to an MCP server.
      // The actual mapping depends on available MCP server implementations
      // for each service. For now, we just register the connection metadata.
      servers[`nango-${conn.provider_config_key}`] = {
        type: 'http',
        url: `${serverUrl}/proxy/${conn.provider_config_key}`,
        headers: { Authorization: `Bearer ${secretKey}` },
      };
    }

    return servers;
  } catch (err) {
    console.error('[NangoMcpBridge] Error building MCP servers:', err);
    return {};
  }
}
