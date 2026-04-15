import type { ConnectorDefinition } from './types';

/**
 * Generic OAuth2 flow handler.
 * In Electron: uses a BrowserWindow that intercepts the redirect URL directly.
 * In browser: falls back to popup window with postMessage.
 *
 * Swappable: replace this module with Nango SDK calls for managed OAuth.
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

export interface OAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

/**
 * Start an OAuth2 authorization flow for a connector.
 * Opens an auth window, waits for the redirect with the auth code,
 * then exchanges the code for tokens server-side.
 */
export async function startOAuthFlow(connector: ConnectorDefinition): Promise<OAuthResult> {
  if (connector.auth.type !== 'oauth2' || !connector.auth.authUrl) {
    throw new Error(`Connector ${connector.id} does not support OAuth2`);
  }

  // Fetch the client_id from server (env vars aren't available client-side)
  const configRes = await fetch(`/api/connectors/oauth/config?connectorId=${connector.id}`);
  if (!configRes.ok) {
    const err = await configRes.json().catch(() => ({}));
    throw new Error(err.error || `Failed to get OAuth config for ${connector.id}`);
  }
  const { clientId } = await configRes.json();

  const state = generateRandomString(32);
  const codeVerifier = connector.auth.pkce ? generateRandomString(64) : undefined;
  const codeChallenge = codeVerifier ? await generateCodeChallenge(codeVerifier) : undefined;

  // The redirect_uri registered with the OAuth provider.
  // In Electron, the auth window intercepts the redirect before it hits the server,
  // so the URL doesn't need to be reachable — it just needs to match what's
  // registered with the provider dashboard.
  // Slack requires https; most others have http registered. Use the connector's
  // redirectScheme if set, otherwise default to http for backwards compatibility.
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.openConnectorAuthWindow;
  const scheme = connector.auth.redirectScheme || 'http';
  const callbackOrigin = isElectron ? `${scheme}://localhost:3000` : (typeof window !== 'undefined' ? window.location.origin : `${scheme}://localhost:3000`);
  const redirectUri = `${callbackOrigin}${CALLBACK_PATH}`;

  // Build authorization URL
  // Slack v2 OAuth uses comma-separated scopes; all other providers use space-separated.
  const isSlackV2 = connector.auth.authUrl.includes('slack.com/oauth/v2');
  const scopeSep = isSlackV2 ? ',' : ' ';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state: `${connector.id}:${state}`,
    ...(connector.auth.scopes?.length && { scope: connector.auth.scopes.join(scopeSep) }),
  });

  // Most OAuth2 providers expect response_type=code, but Slack v2 doesn't use it
  if (!isSlackV2) {
    params.set('response_type', 'code');
  }

  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  // Atlassian requires audience param
  if (connector.id === 'jira' || connector.id === 'confluence') {
    params.set('audience', 'api.atlassian.com');
    params.set('prompt', 'consent');
  }

  const authUrl = `${connector.auth.authUrl}?${params.toString()}`;
  console.log('[OAuth] Auth URL:', authUrl);

  // Get the auth code — Electron intercepts the redirect, browser uses popup
  const { code, error } = await getAuthCode(authUrl, state, connector.id);

  if (error) {
    throw new Error(error === 'canceled' ? 'OAuth flow was canceled' : `OAuth error: ${error}`);
  }
  if (!code) {
    throw new Error('No authorization code received');
  }

  // Exchange code for token server-side
  const tokenResponse = await fetch('/api/connectors/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectorId: connector.id,
      code,
      redirectUri,
      codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.json().catch(() => ({}));
    throw new Error(err.error || `Token exchange failed: ${tokenResponse.status}`);
  }

  return tokenResponse.json();
}

async function getAuthCode(
  authUrl: string,
  expectedState: string,
  connectorId: string
): Promise<{ code: string | null; error: string | null }> {
  // Use Electron's BrowserWindow if available — intercepts redirect directly
  if (typeof window !== 'undefined' && window.electronAPI?.openConnectorAuthWindow) {
    const result = await window.electronAPI.openConnectorAuthWindow(authUrl, CALLBACK_PATH);

    if (result.error) {
      return { code: null, error: result.error };
    }

    // Verify state
    const [, returnedState] = (result.state || '').split(':');
    if (returnedState !== expectedState) {
      return { code: null, error: 'OAuth state mismatch' };
    }

    return { code: result.code, error: null };
  }

  // Fallback: browser popup with postMessage
  return openPopupAndWaitForCode(authUrl, expectedState, connectorId);
}

function openPopupAndWaitForCode(
  authUrl: string,
  expectedState: string,
  connectorId: string
): Promise<{ code: string | null; error: string | null }> {
  return new Promise((resolve) => {
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl,
      `oauth_${connectorId}`,
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no`
    );

    if (!popup) {
      resolve({ code: null, error: 'Failed to open popup window. Please allow popups.' });
      return;
    }

    const popupWindow = popup;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'oauth_callback') return;

      const { code, state, error } = event.data;

      if (error) {
        cleanup();
        resolve({ code: null, error });
        return;
      }

      const [, returnedState] = (state || '').split(':');
      if (returnedState !== expectedState) {
        cleanup();
        resolve({ code: null, error: 'OAuth state mismatch' });
        return;
      }

      cleanup();
      resolve({ code, error: null });
    };

    const pollTimer = setInterval(() => {
      if (popupWindow.closed) {
        cleanup();
        resolve({ code: null, error: 'canceled' });
      }
    }, 500);

    const timeout = setTimeout(() => {
      cleanup();
      popupWindow.close();
      resolve({ code: null, error: 'OAuth flow timed out' });
    }, 5 * 60 * 1000);

    function cleanup() {
      window.removeEventListener('message', handleMessage);
      clearInterval(pollTimer);
      clearTimeout(timeout);
      try { popupWindow.close(); } catch { /* ignore */ }
    }

    window.addEventListener('message', handleMessage);
  });
}
