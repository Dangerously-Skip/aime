export const runtime = 'nodejs';

import { readFile } from 'fs/promises';
import { getMcpConfigPath } from '@/lib/app-paths';
import { classifyProvisioned, diffConnections, type ConnectionMeta } from '@/lib/connectors/health';

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
  let mcpServers: Record<string, { _meta?: ConnectionMeta }> = {};
  try {
    const raw = await readFile(getMcpConfigPath(), 'utf-8');
    mcpServers = (JSON.parse(raw) as { mcpServers?: typeof mcpServers }).mcpServers ?? {};
  } catch {
    // No config yet — nothing is provisioned, which is a valid answer.
  }

  const connectors = classifyProvisioned(mcpServers);

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
