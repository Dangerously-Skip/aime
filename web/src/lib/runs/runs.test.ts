import { describe, it, expect } from 'vitest';
import {
  startRun,
  finishRun,
  addDeliverable,
  costFromUsage,
  summarizeRuns,
  isIntervalDue,
  applyRunToGoal,
  needsVerification,
} from './runs';
import { isTerminal, type Goal, type Run } from './types';

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  objective: 'Summarise overnight build failures',
  approvalPolicy: 'consequential',
  enabled: true,
  createdAt: 0,
  ...over,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  goalId: 'g1',
  trigger: 'cron',
  status: 'succeeded',
  startedAt: 1_000,
  endedAt: 2_000,
  durationMs: 1_000,
  deliverables: [],
  ...over,
});

describe('startRun', () => {
  it('creates an in-flight run with injected id and clock', () => {
    const r = startRun({ id: 'r9', now: 500, goalId: 'g1', trigger: 'cron', surfaceId: 'cowork' });
    expect(r).toMatchObject({ id: 'r9', goalId: 'g1', status: 'running', startedAt: 500, surfaceId: 'cowork' });
    expect(r.deliverables).toEqual([]);
    expect(isTerminal(r.status)).toBe(false);
  });

  it('allows an ad-hoc run with no goal (a plain chat turn)', () => {
    expect(startRun({ id: 'r1', now: 0, trigger: 'chat' }).goalId).toBeNull();
  });
});

describe('finishRun', () => {
  it('stamps status, end time and duration', () => {
    const r = finishRun(startRun({ id: 'r1', now: 1_000, trigger: 'manual' }), {
      now: 4_500,
      status: 'succeeded',
      toolCalls: 3,
      cost: { inputTokens: 10, outputTokens: 5, totalUsd: 0.02 },
    });
    expect(r.status).toBe('succeeded');
    expect(r.durationMs).toBe(3_500);
    expect(r.toolCalls).toBe(3);
    expect(r.cost?.totalUsd).toBe(0.02);
  });

  it('records a failure message', () => {
    const r = finishRun(startRun({ id: 'r1', now: 0, trigger: 'cron' }), {
      now: 10,
      status: 'failed',
      error: 'upstream 502',
    });
    expect(r).toMatchObject({ status: 'failed', error: 'upstream 502' });
  });

  // A late `done` event racing a timeout must not rewrite history.
  it('is idempotent — finishing a terminal run leaves it untouched', () => {
    const timedOut = finishRun(startRun({ id: 'r1', now: 0, trigger: 'cron' }), { now: 100, status: 'timeout' });
    const late = finishRun(timedOut, { now: 900, status: 'succeeded', error: undefined });
    expect(late).toBe(timedOut);
    expect(late.status).toBe('timeout');
    expect(late.durationMs).toBe(100);
  });

  it('never produces a negative duration if the clock moves backwards', () => {
    const r = finishRun(startRun({ id: 'r1', now: 5_000, trigger: 'manual' }), { now: 1_000, status: 'succeeded' });
    expect(r.durationMs).toBe(0);
  });
});

describe('addDeliverable', () => {
  it('appends without mutating the original run', () => {
    const a = startRun({ id: 'r1', now: 0, trigger: 'manual' });
    const b = addDeliverable(a, { kind: 'file', path: '/tmp/report.pdf', summary: 'Q3 report' });
    expect(a.deliverables).toHaveLength(0);
    expect(b.deliverables).toEqual([{ kind: 'file', path: '/tmp/report.pdf', summary: 'Q3 report' }]);
  });
});

describe('costFromUsage', () => {
  it('maps the done-event usage shape', () => {
    expect(costFromUsage({ input_tokens: 100, output_tokens: 50, total_cost_usd: 0.004 })).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalUsd: 0.004,
    });
  });

  it('tolerates partial payloads and returns undefined for nothing usable', () => {
    expect(costFromUsage({ output_tokens: 7 })).toEqual({ inputTokens: 0, outputTokens: 7, totalUsd: 0 });
    expect(costFromUsage(undefined)).toBeUndefined();
    expect(costFromUsage({})).toBeUndefined();
  });
});

describe('summarizeRuns', () => {
  it('reports zeroed/null aggregates for no runs', () => {
    expect(summarizeRuns([])).toMatchObject({
      total: 0,
      successRate: null,
      medianDurationMs: null,
      totalUsd: 0,
      currentlyFailing: false,
    });
  });

  it('computes success rate, median duration and total spend', () => {
    const s = summarizeRuns([
      run({ id: 'a', status: 'succeeded', durationMs: 1_000, cost: { inputTokens: 1, outputTokens: 1, totalUsd: 0.01 } }),
      run({ id: 'b', status: 'failed', durationMs: 3_000, cost: { inputTokens: 1, outputTokens: 1, totalUsd: 0.02 } }),
      run({ id: 'c', status: 'succeeded', durationMs: 2_000 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.medianDurationMs).toBe(2_000);
    expect(s.totalUsd).toBeCloseTo(0.03);
  });

  // A healthy goal must not read as failing merely because a run is in flight.
  it('excludes in-flight runs from rate and median', () => {
    const s = summarizeRuns([
      run({ id: 'a', status: 'succeeded', durationMs: 1_000 }),
      run({ id: 'b', status: 'running', startedAt: 9_000, endedAt: undefined, durationMs: undefined }),
    ]);
    expect(s.successRate).toBe(1);
    expect(s.medianDurationMs).toBe(1_000);
    expect(s.currentlyFailing).toBe(false);
    expect(s.lastRun?.id).toBe('b'); // most recent overall, in-flight included
  });

  it('flags currentlyFailing from the latest TERMINAL run, not the latest overall', () => {
    const failingNow = summarizeRuns([
      run({ id: 'old', status: 'succeeded', startedAt: 1_000 }),
      run({ id: 'new', status: 'failed', startedAt: 5_000 }),
    ]);
    expect(failingNow.currentlyFailing).toBe(true);

    // A retry in flight after a failure still reads as failing until it lands.
    const retrying = summarizeRuns([
      run({ id: 'new', status: 'failed', startedAt: 5_000 }),
      run({ id: 'retry', status: 'running', startedAt: 6_000, durationMs: undefined }),
    ]);
    expect(retrying.currentlyFailing).toBe(true);
  });
});

describe('isIntervalDue', () => {
  it('is due immediately when it has never run — a new widget populates at once', () => {
    expect(isIntervalDue(goal({ schedule: { everySeconds: 3_600 } }), 0)).toBe(true);
  });

  it('waits for the interval to elapse', () => {
    const g = goal({ schedule: { everySeconds: 60 }, lastRunAt: 10_000 });
    expect(isIntervalDue(g, 10_000 + 59_000)).toBe(false);
    expect(isIntervalDue(g, 10_000 + 60_000)).toBe(true);
  });

  it('is never due when disabled or unscheduled', () => {
    expect(isIntervalDue(goal({ enabled: false, schedule: { everySeconds: 1 } }), 1e9)).toBe(false);
    expect(isIntervalDue(goal({}), 1e9)).toBe(false);
    expect(isIntervalDue(goal({ schedule: { everySeconds: 0 } }), 1e9)).toBe(false);
    // cron-scheduled goals are the caller's business, not this function's
    expect(isIntervalDue(goal({ schedule: { cron: '0 * * * *' } }), 1e9)).toBe(false);
  });
});

describe('applyRunToGoal', () => {
  it('stamps lastRunAt and resets the failure streak on success', () => {
    const g = applyRunToGoal(goal({ consecutiveFailures: 3 }), run({ status: 'succeeded', startedAt: 7_000 }));
    expect(g.lastRunAt).toBe(7_000);
    expect(g.consecutiveFailures).toBe(0);
  });

  it('increments the failure streak so escalation and the UI can see it', () => {
    let g = goal();
    g = applyRunToGoal(g, run({ status: 'failed' }));
    g = applyRunToGoal(g, run({ status: 'timeout' }));
    expect(g.consecutiveFailures).toBe(2);
  });

  it('ignores an in-flight run', () => {
    const g = goal({ consecutiveFailures: 1 });
    expect(applyRunToGoal(g, run({ status: 'running' }))).toBe(g);
  });
});

describe('needsVerification', () => {
  it('is true only when the goal states real criteria', () => {
    expect(needsVerification(goal({ successCriteria: 'a PDF exists' }))).toBe(true);
    expect(needsVerification(goal({ successCriteria: '   ' }))).toBe(false);
    expect(needsVerification(goal())).toBe(false);
  });
});
