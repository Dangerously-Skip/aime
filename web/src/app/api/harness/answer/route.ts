import { NextRequest } from 'next/server';
import path from 'node:path';
import { isCrossOriginRequest } from '@/lib/security/same-origin';
import { isAllowedWorkspaceRoot } from '@/lib/security/workspace-root';
import { harnessDir } from '@/lib/harness/ledger';
import { readQuestion, answerQuestion } from '@/lib/harness/question';

export const runtime = 'nodejs';

/**
 * Answer the question a goal run parked on.
 *
 * Separate from the status route because answering is a state change and reading
 * is not — and because a parked run is the one case where the user is the only
 * thing that can move it forward.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const workingDir = typeof body.workingDir === 'string' ? body.workingDir : '';
  const id = typeof body.id === 'string' ? body.id : '';
  const answer = typeof body.answer === 'string' ? body.answer : '';
  if (!workingDir) return Response.json({ error: 'workingDir required' }, { status: 400 });
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  if (!(await isAllowedWorkspaceRoot(workingDir))) {
    return Response.json(
      { error: 'That folder is outside your home and temp directories' },
      { status: 403 },
    );
  }

  const dir = harnessDir(path.resolve(workingDir));
  const result = await answerQuestion(dir, id, answer);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}

/** The question, if the run is waiting on one. */
export async function GET(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const workingDir = request.nextUrl.searchParams.get('workingDir') ?? '';
  if (!workingDir) return Response.json({ error: 'workingDir required' }, { status: 400 });
  if (!(await isAllowedWorkspaceRoot(workingDir))) {
    return Response.json({ error: 'That folder is outside your home and temp directories' }, { status: 403 });
  }
  const q = await readQuestion(harnessDir(path.resolve(workingDir)));
  return Response.json({ question: q && q.answer === null ? q : null });
}
