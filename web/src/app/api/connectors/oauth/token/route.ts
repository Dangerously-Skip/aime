export const runtime = 'nodejs';

import { CONNECTOR_MAP } from '@/lib/connectors/registry';
import { getCredentials } from '@/lib/connectors/credentials';

/**
 * Server-side OAuth token exchange.
 * Exchanges the authorization code for an access token.
 * Client secrets are kept server-side, never exposed to the renderer.
 */
export async function POST(request: Request) {
  try {
    const { connectorId, code, redirectUri, codeVerifier } = await request.json();

    if (!connectorId || !code || !redirectUri) {
      return Response.json(
        { error: 'Missing required fields: connectorId, code, redirectUri' },
        { status: 400 }
      );
    }

    const connector = CONNECTOR_MAP[connectorId];
    if (!connector) {
      return Response.json({ error: `Unknown connector: ${connectorId}` }, { status: 400 });
    }

    if (connector.auth.type !== 'oauth2' || !connector.auth.tokenUrl) {
      return Response.json(
        { error: `Connector ${connectorId} does not support OAuth2 token exchange` },
        { status: 400 }
      );
    }

    const credentials = getCredentials(connectorId);
    if (!credentials || !credentials.clientId || !credentials.clientSecret) {
      return Response.json(
        { error: `No OAuth credentials configured for ${connectorId}. Set the appropriate env vars.` },
        { status: 500 }
      );
    }

    // Build token exchange request
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });

    if (codeVerifier) {
      tokenParams.set('code_verifier', codeVerifier);
    }

    // GitHub requires Accept: application/json
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (connectorId === 'github') {
      headers['Accept'] = 'application/json';
    }

    const tokenResponse = await fetch(connector.auth.tokenUrl, {
      method: 'POST',
      headers,
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`[OAuth Token] Exchange failed for ${connectorId}:`, errorText);
      return Response.json(
        { error: `Token exchange failed: ${tokenResponse.status}` },
        { status: 502 }
      );
    }

    const tokenData = await tokenResponse.json();

    // Normalize response — different providers return slightly different formats
    const accessToken =
      tokenData.access_token ||
      tokenData.authed_user?.access_token; // Slack returns nested

    if (!accessToken) {
      console.error(`[OAuth Token] No access_token in response for ${connectorId}:`, tokenData);
      return Response.json({ error: 'No access token in provider response' }, { status: 502 });
    }

    return Response.json({
      accessToken,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type || 'Bearer',
    });
  } catch (error) {
    console.error('[OAuth Token] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Token exchange failed' },
      { status: 500 }
    );
  }
}
