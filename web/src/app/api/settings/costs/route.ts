import { readRuns } from '@/lib/runs/run-log';
import { summarizeSpend } from '@/lib/runs/spend';

export const runtime = 'nodejs';

/**
 * GET /api/settings/costs
 *
 * Spend per surface and in total, folded from the durable run log — the
 * provider-reported cost of every recorded run. It used to read a map of
 * in-memory cost trackers that nothing ever created, so it always answered
 * zero. See lib/runs/spend.ts.
 */
export async function GET() {
  try {
    return Response.json(summarizeSpend(await readRuns()));
  } catch (err) {
    console.error('[COSTS] Could not read the run log:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Could not read usage history' }, { status: 500 });
  }
}
