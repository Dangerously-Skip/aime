export const runtime = 'nodejs';

import { CONNECTOR_MAP } from '@/lib/connectors/registry';
import { getCredentials } from '@/lib/connectors/credentials';

/**
 * GET /api/connectors/oauth/config?connectorId=jira
 * Returns the OAuth client_id for a connector (public, not secret).
 * Needed because the client-side OAuth flow can't access process.env.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const connectorId = url.searchParams.get('connectorId');

  if (!connectorId) {
    return Response.json({ error: 'Missing connectorId' }, { status: 400 });
  }

  const connector = CONNECTOR_MAP[connectorId];
  if (!connector || connector.auth.type !== 'oauth2') {
    return Response.json({ error: 'Invalid connector' }, { status: 400 });
  }

  const credentials = getCredentials(connectorId);
  if (!credentials?.clientId) {
    return Response.json(
      { error: `No OAuth credentials configured for ${connectorId}` },
      { status: 500 }
    );
  }

  return Response.json({ clientId: credentials.clientId });
}
