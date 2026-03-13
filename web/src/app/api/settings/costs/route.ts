export const runtime = 'nodejs';

// Global cost tracker reference — populated by the chat route when hooks are created.
// This is a read-only snapshot; costs accumulate as queries run.
declare global {
  // eslint-disable-next-line no-var
  var __costTrackers: Map<string, import('@/lib/hooks/cost-tracker').CostTrackerResult> | undefined;
}

function getCostTrackersMap() {
  if (!globalThis.__costTrackers) {
    globalThis.__costTrackers = new Map();
  }
  return globalThis.__costTrackers;
}

export { getCostTrackersMap };

/**
 * GET /api/settings/costs
 * Returns cost breakdown per surface and grand total.
 */
export async function GET() {
  const trackers = getCostTrackersMap();
  const surfaces: Record<string, unknown> = {};
  let totalInput = 0;
  let totalOutput = 0;
  let totalCalls = 0;

  for (const [surfaceId, tracker] of trackers) {
    const cost = tracker.getCost(surfaceId);
    if (cost) {
      surfaces[surfaceId] = cost;
      totalInput += cost.input;
      totalOutput += cost.output;
      totalCalls += cost.calls;
    }
  }

  return Response.json({
    surfaces,
    total: {
      input: totalInput,
      output: totalOutput,
      total: totalInput + totalOutput,
      calls: totalCalls,
    },
  });
}
