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
 *
 * WHAT AUTHORISES THIS. Nothing about the request itself, and unlike
 * /api/chat/document-result there is nothing server-side to check the claim
 * against: `connected: true` describes an OAuth flow that happened in the
 * renderer, so the tool cannot stat a file and see for itself the way the PDF path
 * can. It reaches the model as "the service is wired up now", which the model then
 * tells the user.
 *
 * So the binding is `toolUseId`, which the provider mints per request with a nonce
 * in it and sends only on the SSE stream (lib/rendezvous → issueHandle). The card
 * echoes it back; a caller that cannot read the stream cannot produce it and takes
 * the 404 below. issueHandle states both the threat that stops and the one it does
 * not.
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
    // "Expired" and "never issued that id" answer identically on purpose:
    // distinguishing them would let a caller probe for live ids.
    return Response.json(
      { error: 'No pending connector request found for this toolUseId' },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
