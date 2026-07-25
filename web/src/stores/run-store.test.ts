import { describe, it, expect, beforeEach } from 'vitest';
import { useRunStore, MAX_RUNS_PER_GOAL, MAX_RUNS_TOTAL } from './run-store';
import type { Goal } from '@/lib/runs/types';

const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id,
  objective: `objective ${id}`,
  approvalPolicy: 'consequential',
  enabled: true,
  createdAt: 0,
  ...over,
});

const s = () => useRunStore.getState();

beforeEach(() => {
  useRunStore.setState({ goals: [], runs: [] });
});

describe('goals', () => {
  it('upserts by id rather than duplicating', () => {
    s().addGoal(goal('g1'));
    s().addGoal(goal('g1', { objective: 'edited' }));
    expect(s().goals).toHaveLength(1);
    expect(s().getGoal('g1')?.objective).toBe('edited');
  });

  it('patches and toggles', () => {
    s().addGoal(goal('g1'));
    s().updateGoal('g1', { successCriteria: 'a PDF exists' });
    expect(s().getGoal('g1')?.successCriteria).toBe('a PDF exists');
    s().setGoalEnabled('g1', false);
    expect(s().getGoal('g1')?.enabled).toBe(false);
  });

  it('removing a goal also drops its runs so they cannot orphan', () => {
    s().addGoal(goal('g1'));
    s().beginRun({ id: 'r1', now: 0, goalId: 'g1', trigger: 'cron' });
    s().beginRun({ id: 'r2', now: 0, goalId: null, trigger: 'chat' });
    s().removeGoal('g1');
    expect(s().goals).toHaveLength(0);
    expect(s().runs.map((r) => r.id)).toEqual(['r2']);
  });
});

describe('run lifecycle', () => {
  it('records a run and folds a success back onto its goal', () => {
    s().addGoal(goal('g1', { consecutiveFailures: 2 }));
    s().beginRun({ id: 'r1', now: 1_000, goalId: 'g1', trigger: 'cron', model: 'sonnet' });
    expect(s().getRun('r1')?.status).toBe('running');

    s().endRun('r1', {
      now: 3_000,
      status: 'succeeded',
      cost: { inputTokens: 10, outputTokens: 20, totalUsd: 0.01 },
      toolCalls: 2,
    });

    const run = s().getRun('r1')!;
    expect(run.status).toBe('succeeded');
    expect(run.durationMs).toBe(2_000);
    expect(run.cost?.totalUsd).toBe(0.01);
    // goal updated: stamped and streak reset
    expect(s().getGoal('g1')).toMatchObject({ lastRunAt: 1_000, consecutiveFailures: 0 });
  });

  it('increments the goal failure streak across failures', () => {
    s().addGoal(goal('g1'));
    s().beginRun({ id: 'r1', now: 0, goalId: 'g1', trigger: 'cron' });
    s().endRun('r1', { now: 1, status: 'failed', error: 'boom' });
    s().beginRun({ id: 'r2', now: 10, goalId: 'g1', trigger: 'cron' });
    s().endRun('r2', { now: 11, status: 'timeout' });
    expect(s().getGoal('g1')?.consecutiveFailures).toBe(2);
  });

  it('ending an already-terminal run is a no-op (late done vs timeout race)', () => {
    s().beginRun({ id: 'r1', now: 0, trigger: 'chat' });
    s().endRun('r1', { now: 100, status: 'timeout' });
    s().endRun('r1', { now: 900, status: 'succeeded' });
    expect(s().getRun('r1')).toMatchObject({ status: 'timeout', durationMs: 100 });
  });

  it('ending an unknown or evicted run does not throw or mutate', () => {
    const before = s().runs;
    expect(() => s().endRun('nope', { now: 1, status: 'succeeded' })).not.toThrow();
    expect(s().runs).toBe(before);
  });

  it('attaches deliverables', () => {
    s().beginRun({ id: 'r1', now: 0, trigger: 'manual' });
    s().attachDeliverable('r1', { kind: 'file', path: '/tmp/a.pdf', summary: 'report' });
    expect(s().getRun('r1')?.deliverables).toHaveLength(1);
  });

  it('activeRuns reports only in-flight work', () => {
    s().beginRun({ id: 'r1', now: 0, trigger: 'chat' });
    s().beginRun({ id: 'r2', now: 0, trigger: 'chat' });
    s().endRun('r2', { now: 1, status: 'succeeded' });
    expect(s().activeRuns().map((r) => r.id)).toEqual(['r1']);
  });
});

describe('summaryForGoal', () => {
  it('aggregates only that goal’s runs', () => {
    s().addGoal(goal('g1'));
    s().addGoal(goal('g2'));
    s().beginRun({ id: 'a', now: 0, goalId: 'g1', trigger: 'cron' });
    s().endRun('a', { now: 1_000, status: 'succeeded', cost: { inputTokens: 1, outputTokens: 1, totalUsd: 0.05 } });
    s().beginRun({ id: 'b', now: 0, goalId: 'g1', trigger: 'cron' });
    s().endRun('b', { now: 3_000, status: 'failed' });
    s().beginRun({ id: 'c', now: 0, goalId: 'g2', trigger: 'cron' });
    s().endRun('c', { now: 500, status: 'succeeded' });

    const g1 = s().summaryForGoal('g1');
    expect(g1.total).toBe(2);
    expect(g1.successRate).toBe(0.5);
    expect(g1.totalUsd).toBeCloseTo(0.05);
    expect(s().summaryForGoal('g2').successRate).toBe(1);
  });
});

describe('caps', () => {
  it('keeps at most MAX_RUNS_PER_GOAL per goal, newest first', () => {
    for (let i = 0; i < MAX_RUNS_PER_GOAL + 20; i++) {
      s().beginRun({ id: `r${i}`, now: i, goalId: 'g1', trigger: 'cron' });
    }
    const runs = s().runsForGoal('g1');
    expect(runs).toHaveLength(MAX_RUNS_PER_GOAL);
    // newest survives, oldest evicted
    expect(runs[0].id).toBe(`r${MAX_RUNS_PER_GOAL + 19}`);
    expect(runs.some((r) => r.id === 'r0')).toBe(false);
  });

  // One noisy goal must not evict every other goal's history.
  it('caps per goal before applying the global cap', () => {
    s().beginRun({ id: 'quiet', now: 0, goalId: 'quiet-goal', trigger: 'cron' });
    for (let i = 0; i < MAX_RUNS_TOTAL + 100; i++) {
      s().beginRun({ id: `noisy${i}`, now: i + 1, goalId: 'noisy-goal', trigger: 'cron' });
    }
    expect(s().runsForGoal('noisy-goal')).toHaveLength(MAX_RUNS_PER_GOAL);
    expect(s().runsForGoal('quiet-goal')).toHaveLength(1);
    expect(s().runs.length).toBeLessThanOrEqual(MAX_RUNS_TOTAL);
  });

  it('caps ad-hoc runs as a group of their own', () => {
    for (let i = 0; i < MAX_RUNS_PER_GOAL + 10; i++) {
      s().beginRun({ id: `a${i}`, now: i, goalId: null, trigger: 'chat' });
    }
    expect(s().runs.filter((r) => r.goalId === null)).toHaveLength(MAX_RUNS_PER_GOAL);
  });
});

describe('clearRuns', () => {
  it('clears one goal or everything', () => {
    s().beginRun({ id: 'a', now: 0, goalId: 'g1', trigger: 'cron' });
    s().beginRun({ id: 'b', now: 0, goalId: 'g2', trigger: 'cron' });
    s().clearRuns('g1');
    expect(s().runs.map((r) => r.id)).toEqual(['b']);
    s().clearRuns();
    expect(s().runs).toEqual([]);
  });
});
