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
  /**
   * The credential, when the client actually holds one. Omit it on the re-enable
   * path: `intent=disable` preserved the stored secret, so the server reuses what
   * it already has. Sending a placeholder instead — the Connectors screen used to
   * send the literal word `provisioned` — is how a live token came to be replaced
   * by a string no service accepts.
   */
  token?: string,
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
      // Absent, not empty: `''` and "no token supplied" mean the same thing to the
      // route, and omitting the key keeps the request honest about what we know.
      ...(token !== undefined ? { token } : {}),
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
 * What "turn this connector off" is supposed to mean.
 *
 * `disable` — reversible. Unmounts the MCP entry and keeps everything needed to
 *   switch it back on: the encrypted credential, the refresh token, the expiry,
 *   the token endpoint. This is what the on/off toggle does.
 * `disconnect` — destructive. Deletes the stored credential and revokes the grant
 *   upstream, so reconnecting is a fresh authorization. This is what the
 *   Disconnect button does.
 */
export type DeprovisionIntent = 'disable' | 'disconnect';

/**
 * Deprovision a connector — removes its MCP server entry from the configuration.
 *
 * The intent is REQUIRED. The route defaults an omitted intent to `disable`,
 * which is the safe default for a route but the wrong one for a caller: sending
 * nothing is how Disconnect came to leave the credential encrypted at rest with
 * the grant still live. There is no correct default for "destroy the user's
 * credential or not", so every call site says which it means.
 */
export async function deprovisionConnector(
  connectorId: string,
  intent: DeprovisionIntent,
): Promise<void> {
  const response = await fetch(
    `/api/connectors/provision?connectorId=${encodeURIComponent(connectorId)}&intent=${intent}`,
    { method: 'DELETE' },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to deprovision connector: ${response.status}`);
  }
}
