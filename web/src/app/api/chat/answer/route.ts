import { NextRequest } from 'next/server';
import { resolveAnswer } from '@/lib/pending-questions';

export const runtime = 'nodejs';

/**
 * POST /api/chat/answer
 *
 * Receives user answers for an AskUserQuestion tool call and unblocks
 * the waiting canUseTool promise in the ClaudeProvider.
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
    return Response.json(
      { error: 'No pending question found for this toolUseId' },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
