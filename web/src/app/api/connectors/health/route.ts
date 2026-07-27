export const runtime = 'nodejs';

import { readConnectionHealth, diffConnections } from '@/lib/connectors/health';

/**
 * GET /api/connectors/health[?clientConnected=a,b,c]
 *
 * Per-connector health for everything provisioned, derived from the stored token
 * metadata — no network calls, so this is cheap enough to poll on screen open.
 *
 * Pass the ids the UI currently believes are connected to also get a drift
 * report: the MCP config is what the agent actually uses, while the client store
 * is a separate cache, and the two can disagree.
 *
 * Returns no secrets — only statuses, ids and expiry timestamps.
 */
export async function GET(request: Request) {
  // Reads the config AND the encrypted store: after DR-14 the refresh token is
  // only in the store, and judging health without it reported every healthy
  // mcp-oauth connector as expired once its access token aged out.
  const connectors = await readConnectionHealth();

  const claimed = new URL(request.url).searchParams.get('clientConnected');
  const drift = claimed
    ? diffConnections(
        claimed.split(',').map((s) => s.trim()).filter(Boolean),
        connectors.map((c) => c.id),
      )
    : undefined;

  return Response.json({
    connectors,
    needsReconnect: connectors.filter((c) => c.health.needsReconnect).map((c) => c.id),
    ...(drift ? { drift } : {}),
  });
}
