export const runtime = 'nodejs';

import { CONNECTOR_MAP } from '@/lib/connectors/registry';
import { getCredentials } from '@/lib/connectors/credentials';

/**
 * Server-side OAuth token refresh.
 * Exchanges a refresh_token for a new access_token.
 * Called on-demand before chat requests when the access token is near expiry.
 */
export async function POST(request: Request) {
  try {
    const { connectorId, refreshToken } = await request.json();

    if (!connectorId || !refreshToken) {
      return Response.json(
        { error: 'Missing required fields: connectorId, refreshToken' },
        { status: 400 }
      );
    }

    const connector = CONNECTOR_MAP[connectorId];
    if (!connector) {
      return Response.json({ error: `Unknown connector: ${connectorId}` }, { status: 400 });
    }

    if (connector.auth.type !== 'oauth2' || !connector.auth.tokenUrl) {
      return Response.json(
        { error: `Connector ${connectorId} does not support OAuth2 token refresh` },
        { status: 400 }
      );
    }

    const credentials = getCredentials(connectorId);
    if (!credentials?.clientId) {
      return Response.json(
        { error: `No OAuth credentials configured for ${connectorId}` },
        { status: 500 }
      );
    }
    if (!credentials.publicClient && !credentials.clientSecret) {
      return Response.json(
        { error: `No OAuth client secret configured for ${connectorId}` },
        { status: 500 }
      );
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: credentials.clientId,
    });

    if (!credentials.publicClient) {
      tokenParams.set('client_secret', credentials.clientSecret);
    }

    // Microsoft Entra v2 token endpoints reject refresh requests without a
    // scope parameter for public clients. Replay whatever scopes the connector
    // is registered for.
    if (credentials.publicClient && connector.auth.scopes?.length) {
      tokenParams.set('scope', connector.auth.scopes.join(' '));
    }

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
      console.error(`[OAuth Refresh] Failed for ${connectorId}:`, errorText);
      return Response.json(
        { error: `Token refresh failed: ${tokenResponse.status}` },
        { status: 502 }
      );
    }

    const tokenData = await tokenResponse.json();

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error(`[OAuth Refresh] No access_token in response for ${connectorId}:`, tokenData);
      return Response.json({ error: 'No access token in refresh response' }, { status: 502 });
    }

    console.log(`[OAuth Refresh] Token refreshed for ${connectorId}`);

    return Response.json({
      accessToken,
      refreshToken: tokenData.refresh_token || refreshToken, // Some providers rotate refresh tokens
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type || 'Bearer',
    });
  } catch (error) {
    console.error('[OAuth Refresh] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Token refresh failed' },
      { status: 500 }
    );
  }
}
