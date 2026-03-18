import { Nango } from '@nangohq/node';
import { CONNECTOR_CATALOG } from '@/lib/nango-catalog';

export const runtime = 'nodejs';

export async function GET() {
  const secretKey = process.env.NANGO_SECRET_KEY;
  const serverUrl = process.env.NANGO_SERVER_URL;
  const configured = !!(secretKey && serverUrl && process.env.NANGO_PUBLIC_KEY);

  if (!configured || !secretKey || !serverUrl) {
    return Response.json({
      nangoConfigured: false,
      connectors: CONNECTOR_CATALOG.map((c) => ({ ...c, connected: false })),
    });
  }

  const nango = new Nango({ secretKey, host: serverUrl });

  try {
    const { connections } = await nango.listConnections();

    const connectedSet = new Map<string, string>();
    for (const conn of connections) {
      connectedSet.set(conn.provider_config_key, conn.connection_id);
    }

    const connectors = CONNECTOR_CATALOG.map((c) => ({
      ...c,
      connected: connectedSet.has(c.id),
      connectionId: connectedSet.get(c.id) || undefined,
    }));

    return Response.json({ nangoConfigured: true, connectors });
  } catch (err) {
    console.error('[Nango] Error listing connections:', err);
    return Response.json({
      nangoConfigured: true,
      connectors: CONNECTOR_CATALOG.map((c) => ({ ...c, connected: false })),
      error: 'Failed to fetch connection status',
    });
  }
}
