import type { ConnectorDefinition } from './types';

/**
 * MCP Provisioner — manages connector entries in the MCP configuration.
 *
 * The client sends *which* connector plus the token it just obtained. It does
 * NOT send the MCP entry: the server rebuilds that from the connector registry
 * (see provision-guard.ts), because `command`/`args` decide what the agent
 * executes and must never be caller-controlled.
 */

/**
 * Provision a connector — adds its MCP server entry to the configuration.
 * Calls the server-side API route which manages the .mcp.json file.
 */
export async function provisionConnector(
  connector: ConnectorDefinition,
  token: string,
  tokenMeta?: {
    refreshToken?: string;
    expiresAt?: number;
    /** For byoCredentials connectors — persisted to _meta for server-side refresh. */
    oauthClientId?: string;
    oauthClientSecret?: string;
    oauthTokenEndpoint?: string;
  },
): Promise<void> {
  const response = await fetch('/api/connectors/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectorId: connector.id,
      token,
      refreshToken: tokenMeta?.refreshToken,
      expiresAt: tokenMeta?.expiresAt,
      oauthClientId: tokenMeta?.oauthClientId,
      oauthClientSecret: tokenMeta?.oauthClientSecret,
      oauthTokenEndpoint: tokenMeta?.oauthTokenEndpoint,
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
