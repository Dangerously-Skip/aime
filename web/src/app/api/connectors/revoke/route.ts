export const runtime = 'nodejs';

import { getCredentials } from '@/lib/connectors/credentials';

/**
 * Revoke an OAuth token with the provider.
 * This ensures that reconnecting triggers a fresh authorization flow
 * with updated scopes, rather than silently reusing the old grant.
 */
export async function POST(request: Request) {
  try {
    const { connectorId, token } = await request.json();

    if (!connectorId || !token) {
      return Response.json({ error: 'Missing connectorId or token' }, { status: 400 });
    }

    // GitHub: DELETE /applications/{client_id}/token
    if (connectorId === 'github') {
      const credentials = getCredentials('github');
      if (!credentials?.clientId || !credentials?.clientSecret) {
        // Can't revoke without credentials, but don't block disconnect
        return Response.json({ revoked: false, reason: 'No OAuth credentials configured' });
      }

      const revokeRes = await fetch(
        `https://api.github.com/applications/${credentials.clientId}/token`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({ access_token: token }),
        }
      );

      // 204 = success, 422 = already revoked
      if (revokeRes.status === 204 || revokeRes.status === 422) {
        return Response.json({ revoked: true });
      }

      console.warn(`[Revoke] GitHub revoke returned ${revokeRes.status}`);
      return Response.json({ revoked: false, status: revokeRes.status });
    }

    // Other providers: not implemented yet, just acknowledge
    return Response.json({ revoked: false, reason: 'Revocation not implemented for this provider' });
  } catch (error) {
    console.error('[Revoke] Error:', error);
    // Don't fail the disconnect flow if revocation fails
    return Response.json({ revoked: false, error: String(error) });
  }
}
