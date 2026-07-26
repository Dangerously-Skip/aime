import { NextRequest } from 'next/server';
import { needsVerification, decideRetry } from '@/lib/runs/verification';
import { verifyRunAgainstGoal } from '@/lib/runs/verify-service';
import { appendRun } from '@/lib/runs/run-log';
import type { Goal, Run } from '@/lib/runs/types';

export const runtime = 'nodejs';

/**
 * Verify a completed run against its Goal's success criteria, and say what to
 * do next.
 *
 * POST /api/runs/verify { goal, run, outputSummary? }
 *   → { verification, decision, run }
 *
 * This is the second, cheap judging pass that turns "didn't throw" into "did the
 * job". A run can come back `succeeded` with `verification.passed === false` —
 * the state no reference tool surfaces, and the one a user most needs to know
 * about unattended work.
 *
 * The re-recorded run is appended to the log so the verdict is durable; the run
 * log is append-only, so the verified record supersedes the bare one on read
 * (newest first, same id).
 */

interface Body {
  goal?: Goal;
  run?: Run;
  outputSummary?: string;
  /**
   * When false, the verdict is returned but NOT appended to the run log. Used
   * for completion-condition checks on standing orders, where the verdict
   * decides whether to stop the order — grading the run with it would make a
   * watch-type order read as failing every night until the day it completes.
   */
  persist?: boolean;
}

function isGoal(v: unknown): v is Goal {
  const g = v as Partial<Goal> | null;
  return Boolean(g && typeof g === 'object' && typeof g.id === 'string' && typeof g.objective === 'string');
}
function isRun(v: unknown): v is Run {
  const r = v as Partial<Run> | null;
  return Boolean(
    r && typeof r === 'object' && typeof r.id === 'string' && typeof r.status === 'string' && Array.isArray(r.deliverables),
  );
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isGoal(body.goal) || !isRun(body.run)) {
    return Response.json({ error: 'A goal and a run are required' }, { status: 400 });
  }
  const { goal, run } = body;

  // No criteria ⇒ nothing to verify. Report that plainly rather than inventing a
  // pass, so the UI can distinguish "verified" from "we never checked".
  if (!needsVerification(goal)) {
    return Response.json({
      verification: null,
      decision: decideRetry({ goal, run, attempt: 1 }),
      run,
    });
  }

  const verdict = await verifyRunAgainstGoal(goal, run, body.outputSummary ?? '');

  const verified: Run = { ...run, verification: verdict };
  const decision = decideRetry({ goal, run: verified, attempt: 1 });

  // Durable: append the verified record. Best-effort — a failed write must not
  // fail the verification response.
  if (body.persist !== false) {
    await appendRun(verified).catch(() => false);
  }

  return Response.json({ verification: verdict, decision, run: verified });
}
