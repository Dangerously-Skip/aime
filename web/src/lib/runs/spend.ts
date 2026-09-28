import type { Run } from './types';

/**
 * API spend per surface, from the run log.
 *
 * Settings → Usage & ROI had a per-surface cost table fed by an in-memory
 * "cost tracker" that nothing ever created, so it read $0.00 for everyone. The
 * tracker would not have been worth wiring anyway: it GUESSED — 500 input and
 * 200 output tokens per tool call, priced from a hardcoded table a model
 * generation out of date.
 *
 * The run log already holds the real numbers. Every turn on every surface is
 * recorded as a Run (use-run-recorder, and the server-side schedulers), and its
 * `cost` is what the provider REPORTED, cache tokens included. So this is a
 * fold over that log rather than a second meter.
 */

export interface SurfaceSpend {
  inputTokens: number;
  outputTokens: number;
  totalUsd: number;
  /** Runs that reported a cost. */
  runs: number;
}

export interface SpendSummary {
  surfaces: Record<string, SurfaceSpend>;
  total: SurfaceSpend;
  /** How many runs the log held — the window this covers (it is capped). */
  runsConsidered: number;
}

/** Runs with no `surfaceId` — the server's unattended work. */
export const UNATTRIBUTED_SURFACE = 'background';

const empty = (): SurfaceSpend => ({ inputTokens: 0, outputTokens: 0, totalUsd: 0, runs: 0 });

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

export function summarizeSpend(runs: readonly Run[]): SpendSummary {
  const surfaces: Record<string, SurfaceSpend> = {};
  const total = empty();
  for (const run of runs) {
    if (!run.cost) continue;
    const key = run.surfaceId || UNATTRIBUTED_SURFACE;
    const bucket = (surfaces[key] ??= empty());
    for (const b of [bucket, total]) {
      b.inputTokens += finite(run.cost.inputTokens);
      b.outputTokens += finite(run.cost.outputTokens);
      b.totalUsd += finite(run.cost.totalUsd);
      b.runs += 1;
    }
  }
  return { surfaces, total, runsConsidered: runs.length };
}
