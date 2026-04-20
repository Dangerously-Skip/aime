import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/sessions — List Claude Agent SDK sessions.
 * Returns session metadata (ID, summary, last modified, cwd, git branch).
 */
export async function GET() {
  try {
    const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');
    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sessions] Failed to list sessions:', msg);
    return NextResponse.json({ error: msg, sessions: [] }, { status: 500 });
  }
}

/**
 * DELETE /api/sessions — Delete a session by ID.
 * Body: { sessionId: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { sessionId } = await req.json() as { sessionId?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const { deleteSession } = await import('@anthropic-ai/claude-agent-sdk');
    await deleteSession(sessionId);
    console.log('[Sessions] Deleted session:', sessionId);
    return NextResponse.json({ ok: true, sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sessions] Failed to delete session:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/sessions — Fork a session into a new branch.
 * Body: { sessionId: string, title?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { sessionId, title } = await req.json() as { sessionId?: string; title?: string };
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
    const result = await forkSession(sessionId, { title });
    console.log('[Sessions] Forked session:', sessionId, '→', result.sessionId);
    return NextResponse.json({ ok: true, originalSessionId: sessionId, newSessionId: result.sessionId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Sessions] Failed to fork session:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
