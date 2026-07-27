import { NextRequest } from 'next/server';
import { resolveConnectorRequest } from '@/lib/pending-connectors';

export const runtime = 'nodejs';

/**
 * POST /api/chat/connector-result
 *
 * Reports the outcome of an agent-initiated connect request (P3.3) and unblocks
 * the waiting canUseTool promise, so the agent's paused turn resumes on the
 * original SSE stream.
 *
 * Body: { toolUseId, connected, reason? }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { toolUseId, connected, reason } = body as {
    toolUseId?: string;
    connected?: boolean;
    reason?: string;
  };

  if (!toolUseId || typeof connected !== 'boolean') {
    return Response.json(
      { error: 'toolUseId and connected are required' },
      { status: 400 },
    );
  }

  const resolved = resolveConnectorRequest(toolUseId, {
    connected,
    // Keep the message short — it goes into the model's tool result.
    ...(typeof reason === 'string' && reason ? { reason: reason.slice(0, 300) } : {}),
  });

  if (!resolved) {
    return Response.json(
      { error: 'No pending connector request found for this toolUseId' },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
