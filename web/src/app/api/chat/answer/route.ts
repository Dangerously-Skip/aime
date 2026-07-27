import { NextRequest } from 'next/server';
import { resolveAnswer } from '@/lib/pending-questions';

export const runtime = 'nodejs';

/**
 * POST /api/chat/answer
 *
 * Receives user answers for an AskUserQuestion tool call and unblocks
 * the waiting canUseTool promise in the ClaudeProvider.
 *
 * WHAT AUTHORISES THIS. Nothing about the request itself: there is no session and
 * no origin check, so `answers` is whatever the caller says it is — and it becomes
 * what the model believes the user chose, including "Allow" at the MCP approval
 * gate. The binding is `toolUseId`. The provider mints one per request with a
 * nonce in it and sends it only on the SSE stream (lib/rendezvous → issueHandle),
 * so presenting it is proof of having received the card we sent; anything else
 * takes the 404 below. See issueHandle for who that does and does not stop —
 * briefly, it stops every caller that cannot read the stream, which is every web
 * page the user has open and every other program on the machine.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { toolUseId, answers } = body as {
    toolUseId?: string;
    answers?: Record<string, string>;
  };

  if (!toolUseId || !answers) {
    return Response.json(
      { error: 'toolUseId and answers are required' },
      { status: 400 },
    );
  }

  const resolved = resolveAnswer(toolUseId, answers);

  if (!resolved) {
    // Covers both "expired" and "never issued that id", deliberately with one
    // message: telling the two apart would let a caller probe for live ids.
    return Response.json(
      { error: 'No pending question found for this toolUseId' },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
