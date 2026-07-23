import { APP_NAME } from '@/config/branding';
/**
 * MCP OAuth 2.1 discovery and dynamic client registration.
 *
 * Implements the standard flow used by Claude Desktop / Claude Code CLI:
 * 1. Hit the MCP URL, get 401 with WWW-Authenticate header
 * 2. Fetch `.well-known/oauth-authorization-server` metadata
 * 3. POST to registration_endpoint (RFC 7591 Dynamic Client Registration)
 * 4. Return auth/token/registration URLs for the OAuth flow
 *
 * Spec: https://modelcontextprotocol.io/specification/draft/basic/authorization
 */

export interface OAuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
}

export interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
}

export interface McpAuthConfig {
  /** The URL of the MCP server */
  mcpUrl: string;
  /** OAuth authorization server metadata */
  metadata: OAuthServerMetadata;
  /** Registered client credentials from DCR */
  client: RegisteredClient;
  /** Scopes to request */
  scopes: string[];
}

/**
 * Discover the OAuth authorization server for an MCP endpoint.
 *
 * Steps:
 * 1. Probe the MCP URL — if it returns 401, read WWW-Authenticate for resource metadata URL
 * 2. Fetch protected resource metadata (RFC 9728) to find authorization_servers
 * 3. Fetch authorization server metadata (RFC 8414) for endpoints
 */
export async function discoverMcpOAuth(mcpUrl: string): Promise<{
  resourceMetadata?: ProtectedResourceMetadata;
  serverMetadata: OAuthServerMetadata;
}> {
  // Step 1: Probe the MCP URL to trigger 401
  let authServerUrl: string | undefined;
  let resourceMetadataUrl: string | undefined;

  try {
    const probeRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    if (probeRes.status === 401) {
      const wwwAuth = probeRes.headers.get('www-authenticate') || '';
      // Look for resource_metadata="..." in WWW-Authenticate header
      const resMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
      if (resMatch) resourceMetadataUrl = resMatch[1];
    }
  } catch (err) {
    console.warn('[MCP OAuth] Probe failed, will try well-known fallback:', err);
  }

  // Step 2: Fetch protected resource metadata if available
  let resourceMetadata: ProtectedResourceMetadata | undefined;
  if (resourceMetadataUrl) {
    try {
      const res = await fetch(resourceMetadataUrl);
      if (res.ok) {
        resourceMetadata = await res.json();
        authServerUrl = resourceMetadata?.authorization_servers?.[0];
      }
    } catch (err) {
      console.warn('[MCP OAuth] Failed to fetch resource metadata:', err);
    }
  }

  // Fallback: derive auth server from MCP URL origin
  if (!authServerUrl) {
    const url = new URL(mcpUrl);
    authServerUrl = `${url.protocol}//${url.host}`;
  }

  // Step 3: Fetch authorization server metadata
  // Try both RFC 8414 locations: /.well-known/oauth-authorization-server and /.well-known/openid-configuration
  const metadataUrls = [
    `${authServerUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    `${authServerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`,
  ];

  let serverMetadata: OAuthServerMetadata | undefined;
  for (const url of metadataUrls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        serverMetadata = await res.json();
        break;
      }
    } catch {
      // Try next
    }
  }

  if (!serverMetadata) {
    throw new Error(
      `Failed to discover OAuth metadata for ${mcpUrl}. Tried: ${metadataUrls.join(', ')}`
    );
  }

  if (!serverMetadata.authorization_endpoint || !serverMetadata.token_endpoint) {
    throw new Error('OAuth server metadata is missing required endpoints');
  }

  return { resourceMetadata, serverMetadata };
}

/**
 * Register the app as a dynamic OAuth client (RFC 7591).
 *
 * The MCP server's authorization server must support Dynamic Client Registration.
 * Some servers (like Atlassian) support this, others require pre-registered clients.
 */
export async function registerOAuthClient(
  metadata: OAuthServerMetadata,
  redirectUri: string,
  clientName = APP_NAME,
): Promise<RegisteredClient> {
  if (!metadata.registration_endpoint) {
    throw new Error(
      `This MCP server does not support Dynamic Client Registration. ` +
      `You would need to pre-register a client with the provider.`
    );
  }

  const body = {
    client_name: clientName,
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // Public client (no client_secret) — PKCE required
    application_type: 'native',
  };

  const res = await fetch(metadata.registration_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DCR failed (${res.status}): ${text}`);
  }

  const client = await res.json() as RegisteredClient;
  if (!client.client_id) {
    throw new Error('DCR response missing client_id');
  }

  return client;
}
