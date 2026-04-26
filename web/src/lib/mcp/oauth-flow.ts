/**
 * Client-side MCP OAuth 2.1 flow.
 * Handles the browser-based auth code flow with PKCE, using Electron's auth window.
 */

const CALLBACK_PATH = '/api/connectors/oauth/callback';

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface McpOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Run the full OAuth 2.1 authorization code flow with PKCE
 * for an MCP server that supports Dynamic Client Registration.
 *
 * @param mcpName - Unique identifier used to key the registration and provisioned MCP entry
 * @param mcpUrl - Optional: direct MCP server URL. If omitted, resolved from installed plugin.
 * @param fallbackClientId - Optional: pre-registered client ID, used if server doesn't support DCR.
 */
export async function runMcpOAuthFlow(
  mcpName: string,
  mcpUrl?: string,
  options?: { fallbackClientId?: string; fallbackClientIdEnv?: string },
): Promise<McpOAuthResult> {
  // Step 1: Trigger discovery + DCR on the server
  const setupRes = await fetch('/api/mcp/oauth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mcpName, mcpUrl, ...options }),
  });

  if (!setupRes.ok) {
    const err = await setupRes.json().catch(() => ({}));
    throw new Error(err.error || `Setup failed: ${setupRes.status}`);
  }

  const {
    authorizationEndpoint,
    tokenEndpoint,
    clientId,
    scopes,
    redirectUri,
  } = await setupRes.json();

  // Step 2: Build auth URL with PKCE
  const state = generateRandomString(32);
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: `mcp:${mcpName}:${state}`,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  if (scopes && scopes.length > 0) {
    params.set('scope', scopes.join(' '));
  }

  const authUrl = `${authorizationEndpoint}?${params.toString()}`;
  console.log('[MCP OAuth] Auth URL:', authUrl);

  // Step 3: Open auth window and wait for callback
  if (typeof window === 'undefined' || !window.electronAPI?.openConnectorAuthWindow) {
    throw new Error('MCP OAuth is only supported in the Electron desktop app');
  }

  const result = await window.electronAPI.openConnectorAuthWindow(authUrl, CALLBACK_PATH);

  if (result.error) {
    throw new Error(result.error === 'canceled' ? 'OAuth flow was canceled' : result.error);
  }
  if (!result.code) {
    throw new Error('No authorization code received');
  }

  // Step 4: Exchange code for tokens via our server
  const tokenRes = await fetch('/api/mcp/oauth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mcpName,
      code: result.code,
      codeVerifier,
      redirectUri,
      tokenEndpoint,
      clientId,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(err.error || `Token exchange failed: ${tokenRes.status}`);
  }

  return tokenRes.json();
}
