/**
 * Pure lifecycle + aggregation for Runs. No I/O, no store, no clock — every
 * function takes the time it needs, so the whole module is deterministic and
 * testable (and safe under the Date.now()-free constraints elsewhere).
 */
import {
  isTerminal,
  type Deliverable,
  type Goal,
  type Run,
  type RunCost,
  type RunStatus,
  type RunSummary,
  type RunTrigger,
} from './types';

/** Start a run. `now` and `id` are injected so callers own time and identity. */
export function startRun(params: {
  id: string;
  now: number;
  goalId?: string | null;
  trigger: RunTrigger;
  surfaceId?: string;
  model?: string;
}): Run {
  return {
    id: params.id,
    goalId: params.goalId ?? null,
    trigger: params.trigger,
    surfaceId: params.surfaceId,
    model: params.model,
    status: 'running',
    startedAt: params.now,
    deliverables: [],
  };
}

/**
 * Move a run to a terminal state. Idempotent: finishing an already-terminal run
 * returns it unchanged, so a late `done` event after a timeout can't rewrite
 * history (a real hazard — SSE `done` and a timeout can race).
 */
export function finishRun(
  run: Run,
  params: {
    now: number;
    status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled' | 'timeout'>;
    error?: string;
    cost?: RunCost;
    toolCalls?: number;
    deliverables?: Deliverable[];
    verification?: Run['verification'];
  },
): Run {
  if (isTerminal(run.status)) return run;
  const endedAt = params.now;
  return {
    ...run,
    status: params.status,
    endedAt,
    // Clamp: a clock adjustment mid-run must not yield a negative duration.
    durationMs: Math.max(0, endedAt - run.startedAt),
    ...(params.error ? { error: params.error } : {}),
    ...(params.cost ? { cost: params.cost } : {}),
    ...(params.toolCalls != null ? { toolCalls: params.toolCalls } : {}),
    ...(params.verification ? { verification: params.verification } : {}),
    deliverables: params.deliverables ?? run.deliverables,
  };
}

/** Attach a deliverable to an in-flight run. */
export function addDeliverable(run: Run, deliverable: Deliverable): Run {
  return { ...run, deliverables: [...run.deliverables, deliverable] };
}

/**
 * Build a RunCost from the numbers AIME's `done` SSE event already carries.
 * Tolerates partial payloads — telemetry is best-effort and must never throw.
 */
export function costFromUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  total_cost_usd?: number;
}): RunCost | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const totalUsd = usage.total_cost_usd ?? 0;
  if (!inputTokens && !outputTokens && !totalUsd) return undefined;
  return { inputTokens, outputTokens, totalUsd };
}

/**
 * Build a RunCost from `StreamUsage` — the shape `use-sse-stream` has ALREADY
 * normalized from the raw `done` event. Kept separate from `costFromUsage`
 * rather than making one function sniff between camelCase and snake_case: the
 * two shapes come from different layers (client hook vs raw server event) and a
 * silent mismatch here would record zero cost on every run, which is worse than
 * a type error.
 */
export function costFromStreamUsage(usage?: {
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
}): RunCost | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalUsd = usage.cost ?? 0;
  if (!inputTokens && !outputTokens && !totalUsd) return undefined;
  return { inputTokens, outputTokens, totalUsd };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate a Goal's runs for display. Rates and medians consider only terminal
 * runs — counting an in-flight run as "not yet succeeded" would make a healthy
 * goal look like it was failing while it worked.
 */
export function summarizeRuns(runs: Run[]): RunSummary {
  const terminal = runs.filter((r) => isTerminal(r.status));
  const succeeded = terminal.filter((r) => r.status === 'succeeded').length;
  const failed = terminal.length - succeeded;
  const totalUsd = runs.reduce((sum, r) => sum + (r.cost?.totalUsd ?? 0), 0);

  // Most recent by start time, in-flight included — that's "what's happening".
  const lastRun = runs.reduce<Run | undefined>(
    (latest, r) => (!latest || r.startedAt > latest.startedAt ? r : latest),
    undefined,
  );
  const lastTerminal = terminal.reduce<Run | undefined>(
    (latest, r) => (!latest || r.startedAt > latest.startedAt ? r : latest),
    undefined,
  );

  return {
    total: runs.length,
    succeeded,
    failed,
    successRate: terminal.length ? succeeded / terminal.length : null,
    totalUsd,
    medianDurationMs: median(terminal.map((r) => r.durationMs ?? 0)),
    lastRun,
    currentlyFailing: Boolean(lastTerminal && lastTerminal.status !== 'succeeded'),
  };
}

/**
 * Is a scheduled Goal due? Interval schedules only — cron is delegated to the
 * existing `matchesCron()` by the caller, which owns the tick.
 *
 * A disabled goal is never due. A goal that has never run is due immediately,
 * which is what makes a newly-created widget populate rather than sit blank
 * until its first interval elapses.
 */
export function isIntervalDue(goal: Goal, now: number): boolean {
  if (!goal.enabled) return false;
  const every = goal.schedule?.everySeconds;
  if (!every || every <= 0) return false;
  if (goal.lastRunAt == null) return true;
  return now - goal.lastRunAt >= every * 1000;
}

/**
 * Apply a finished run back onto its Goal: stamp lastRunAt and maintain the
 * consecutive-failure counter that drives escalation and the "this is broken"
 * signal in the UI.
 */
export function applyRunToGoal(goal: Goal, run: Run): Goal {
  if (!isTerminal(run.status)) return goal;
  const failed = run.status !== 'succeeded';
  return {
    ...goal,
    lastRunAt: run.startedAt,
    consecutiveFailures: failed ? (goal.consecutiveFailures ?? 0) + 1 : 0,
  };
}

/**
 * Did the run meet its Goal's criteria? Returns undefined when the Goal states
 * no criteria — the caller should surface that as "unverified" rather than
 * silently treating a non-error as success, which is openworker's weak spot.
 */
export function needsVerification(goal: Goal): boolean {
  return Boolean(goal.successCriteria?.trim());
}
