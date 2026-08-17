import { describe, it, expect } from 'vitest';
import {
  shouldStop,
  recordSession,
  newRunState,
  needsAttention,
  DEFAULT_POLICY,
  type RunState,
} from './stop';
import type { Goal, Ledger } from './ledger';

/**
 * Every condition here must have a test that fails when it is removed.
 *
 * The motivating incident: an agent retried 240 times over three hours for
 * $4,200 while three dashboards displayed the spend and none of them could stop
 * it. A stop condition nothing would notice the loss of is a dashboard.
 */
const NOW = Date.parse('2026-08-16T12:00:00.000Z');

const goal = (over: Partial<Goal> = {}): Goal => ({
  version: 1,
  objective: 'Ship the thing',
  acceptanceCriteria: [],
  budgetUsd: 10,
  deadlineIso: null,
  sessionCap: 50,
  createdAt: '2026-08-16T00:00:00.000Z',
  ...over,
});

const ledger = (over: Partial<Ledger['tasks'][0]> = {}): Ledger => ({
  version: 1,
  tasks: [
    { id: 't-1', title: 'A', verify: [], status: 'todo', attempts: 0, lastVerdict: null, ...over },
  ],
});

const run = (over: Partial<RunState> = {}): RunState => ({
  ...newRunState(NOW),
  lastStateHash: 'abc',
  ...over,
});

describe('success beats every limit', () => {
  it('reports complete, not budget, when the last dollar finished the job', () => {
    // Being told you ran out of money when you got what you asked for is a lie
    // of ordering, and the kind users remember.
    const done: Ledger = { version: 1, tasks: [{ ...ledger().tasks[0], status: 'passed' }] };
    const d = shouldStop({ goal: goal({ budgetUsd: 1 }), ledger: done, run: run({ spentUsd: 5 }), nowMs: NOW });
    expect(d).toMatchObject({ stop: true, reason: 'complete' });
  });
});

describe('budget', () => {
  it('stops at the limit', () => {
    const d = shouldStop({ goal: goal({ budgetUsd: 10 }), ledger: ledger(), run: run({ spentUsd: 10 }), nowMs: NOW });
    expect(d).toMatchObject({ stop: true, reason: 'budget' });
  });

  it('keeps going below it', () => {
    expect(shouldStop({ goal: goal(), ledger: ledger(), run: run({ spentUsd: 9.99 }), nowMs: NOW }).stop).toBe(false);
  });

  it('null means no limit; ZERO means zero', () => {
    /*
     * The existing resume loop writes `!effectiveBudgetUsd || spent < budget`,
     * which reads a budget of 0 as unlimited — the exact inversion of what
     * setting it to zero means. These are different values here.
     */
    expect(shouldStop({ goal: goal({ budgetUsd: null }), ledger: ledger(), run: run({ spentUsd: 1e6 }), nowMs: NOW }).stop).toBe(false);
    expect(shouldStop({ goal: goal({ budgetUsd: 0 }), ledger: ledger(), run: run({ spentUsd: 0 }), nowMs: NOW })).toMatchObject({ reason: 'budget' });
  });

  it('names the numbers, so the user can act on it', () => {
    const d = shouldStop({ goal: goal({ budgetUsd: 10 }), ledger: ledger(), run: run({ spentUsd: 12.5 }), nowMs: NOW });
    expect(d.detail).toContain('12.50');
    expect(d.detail).toContain('10.00');
  });
});

describe('deadline', () => {
  it('stops once reached', () => {
    const d = shouldStop({
      goal: goal({ deadlineIso: new Date(NOW - 1000).toISOString() }),
      ledger: ledger(), run: run(), nowMs: NOW,
    });
    expect(d).toMatchObject({ stop: true, reason: 'deadline' });
  });

  it('keeps going before it', () => {
    const d = shouldStop({
      goal: goal({ deadlineIso: new Date(NOW + 60_000).toISOString() }),
      ledger: ledger(), run: run(), nowMs: NOW,
    });
    expect(d.stop).toBe(false);
  });

  it('a deadline it cannot parse is an ERROR, not an absent deadline', () => {
    /*
     * Treating an unevaluable limit as no limit is how a control ends up looking
     * enforced while enforcing nothing — the shape four security toggles in this
     * repo shipped with.
     */
    const d = shouldStop({ goal: goal({ deadlineIso: 'next tuesday' }), ledger: ledger(), run: run(), nowMs: NOW });
    expect(d).toMatchObject({ stop: true, reason: 'error' });
  });
});

describe('session cap', () => {
  it('stops at the cap', () => {
    expect(shouldStop({ goal: goal({ sessionCap: 3 }), ledger: ledger(), run: run({ sessions: 3 }), nowMs: NOW }))
      .toMatchObject({ stop: true, reason: 'session-cap' });
  });
  it('null means uncapped', () => {
    expect(shouldStop({ goal: goal({ sessionCap: null }), ledger: ledger(), run: run({ sessions: 9999 }), nowMs: NOW }).stop).toBe(false);
  });
});

describe('no progress', () => {
  it('stops after the idle limit', () => {
    const d = shouldStop({ goal: goal(), ledger: ledger(), run: run({ idleSessions: DEFAULT_POLICY.idleLimit }), nowMs: NOW });
    expect(d).toMatchObject({ stop: true, reason: 'no-progress' });
  });

  it('tolerates fewer than the limit', () => {
    // One session that moves nothing is ordinary: reading the code, reproducing
    // a bug and writing a failing test all move no task.
    expect(shouldStop({ goal: goal(), ledger: ledger(), run: run({ idleSessions: DEFAULT_POLICY.idleLimit - 1 }), nowMs: NOW }).stop).toBe(false);
  });
});

describe('stuck task', () => {
  it('stops when one task has burned the attempt limit', () => {
    const d = shouldStop({
      goal: goal(),
      ledger: ledger({ attempts: DEFAULT_POLICY.attemptLimit }),
      run: run(), nowMs: NOW,
    });
    expect(d).toMatchObject({ stop: true, reason: 'stuck-task' });
    expect(d.detail).toContain('A');
  });

  it('ignores attempts on a task that has since passed', () => {
    const d = shouldStop({
      goal: goal(),
      ledger: ledger({ attempts: 99, status: 'passed' }),
      run: run(), nowMs: NOW,
    });
    // The single task passed, so this is `complete` — the point is that a high
    // attempt count on finished work is not a failure.
    expect(d.reason).toBe('complete');
  });
});

describe('user cancel', () => {
  it('beats every limit except success', () => {
    expect(shouldStop({ goal: goal(), ledger: ledger(), run: run({ cancelled: true }), nowMs: NOW }))
      .toMatchObject({ stop: true, reason: 'user' });
  });
});

describe('recordSession — the idle counter', () => {
  it('does not count the first session as idle', () => {
    const r = recordSession(newRunState(NOW), { costUsd: 1, stateHash: 'h1' });
    expect(r.idleSessions).toBe(0);
    expect(r.sessions).toBe(1);
    expect(r.spentUsd).toBe(1);
  });

  it('increments when the state hash does not move', () => {
    let r = recordSession(newRunState(NOW), { costUsd: 1, stateHash: 'h1' });
    r = recordSession(r, { costUsd: 1, stateHash: 'h1' });
    r = recordSession(r, { costUsd: 1, stateHash: 'h1' });
    expect(r.idleSessions).toBe(2);
  });

  it('resets the moment something moves', () => {
    let r = recordSession(newRunState(NOW), { costUsd: 0, stateHash: 'h1' });
    r = recordSession(r, { costUsd: 0, stateHash: 'h1' });
    expect(r.idleSessions).toBe(1);
    r = recordSession(r, { costUsd: 0, stateHash: 'h2' });
    expect(r.idleSessions).toBe(0);
  });

  it('accumulates spend across sessions', () => {
    let r = newRunState(NOW);
    for (let i = 0; i < 4; i++) r = recordSession(r, { costUsd: 0.25, stateHash: 'h1' });
    expect(r.spentUsd).toBeCloseTo(1);
  });

  it('a run that spends and moves nothing eventually stops', () => {
    /*
     * The end-to-end property, and the whole reason the module exists: a loop
     * that retries into a wall must terminate on its own.
     */
    let r = newRunState(NOW);
    let sessions = 0;
    while (!shouldStop({ goal: goal(), ledger: ledger(), run: r, nowMs: NOW }).stop) {
      r = recordSession(r, { costUsd: 0.5, stateHash: 'stuck' });
      sessions++;
      expect(sessions).toBeLessThan(50); // would hang if nothing stopped it
    }
    expect(shouldStop({ goal: goal(), ledger: ledger(), run: r, nowMs: NOW }).reason).toBe('no-progress');
    expect(sessions).toBe(DEFAULT_POLICY.idleLimit + 1);
  });
});

describe('needsAttention', () => {
  it('flags the endings a human should look at', () => {
    expect(needsAttention('no-progress')).toBe(true);
    expect(needsAttention('stuck-task')).toBe(true);
    expect(needsAttention('error')).toBe(true);
    expect(needsAttention('complete')).toBe(false);
    expect(needsAttention('user')).toBe(false);
    expect(needsAttention('budget')).toBe(false);
  });
});
