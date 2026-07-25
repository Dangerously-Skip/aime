import { NextRequest } from 'next/server';
import { appendRun, readRuns, RUN_LOG_READ_LIMIT } from '@/lib/runs/run-log';
import { summarizeRuns } from '@/lib/runs/runs';
import type { Run } from '@/lib/runs/types';

export const runtime = 'nodejs';

/**
 * The durable run log.
 *
 * GET  /api/runs?limit=&goalId=   → { runs, summary }
 * POST /api/runs { run }          → { ok }
 *
 * Runs live on disk rather than in localStorage so they can't compete with
 * conversations for quota, don't re-serialize on every turn, and survive both a
 * restart and work done while the window was closed. See lib/runs/run-log.ts.
 */

/** Minimal shape check — a malformed record must not poison the log. */
function isRunLike(value: unknown): value is Run {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Run>;
  return (
    typeof r.id === 'string' &&
    typeof r.status === 'string' &&
    typeof r.startedAt === 'number' &&
    Array.isArray(r.deliverables)
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const goalId = searchParams.get('goalId') ?? undefined;

  const rawLimit = Number(searchParams.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), RUN_LOG_READ_LIMIT)
      : RUN_LOG_READ_LIMIT;

  const runs = await readRuns({ limit, goalId });
  return Response.json({ runs, summary: summarizeRuns(runs) });
}

export async function POST(req: NextRequest) {
  let body: { run?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRunLike(body.run)) {
    return Response.json({ error: 'A valid run record is required' }, { status: 400 });
  }

  const ok = await appendRun(body.run);
  // A failed append is reported but never 500s the caller: recording a run must
  // not be able to fail the turn it describes.
  return Response.json({ ok });
}
