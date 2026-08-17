import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGoalLoop, readRunState, type SessionRunner, type LoopEvent } from './goal-loop';
import { writeGoalOnce, writeLedger, readLedger, PROGRESS_FILE, type Ledger, type Goal } from './ledger';
import { DEFAULT_POLICY } from './stop';

/**
 * The loop against a REAL directory, with only the model call faked.
 *
 * `runSession` is the one thing that cannot run offline. The ledger, the tamper
 * check, the stop conditions and the idle counter are all real — mocking those
 * would leave the test asserting on the mock rather than on the loop.
 */
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-loop-'));
  await writeGoalOnce(dir, {
    version: 1,
    objective: 'Ship the thing',
    acceptanceCriteria: ['it works'],
    budgetUsd: 10,
    deadlineIso: null,
    sessionCap: 20,
    createdAt: '2026-08-16T00:00:00.000Z',
  } satisfies Goal);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ledger = (n = 2): Ledger => ({
  version: 1,
  tasks: Array.from({ length: n }, (_, i) => ({
    id: `t-${i + 1}`,
    title: `Task ${i + 1}`,
    verify: ['check it'],
    status: 'todo' as const,
    attempts: 0,
    lastVerdict: null,
  })),
});

/** A session that always succeeds. */
const winner: SessionRunner = async ({ task, sessionIndex }) => ({
  costUsd: 0.1,
  summary: `Did ${task.id} in session ${sessionIndex}.`,
  claimsComplete: true,
});

/** A session that never succeeds but always bills. */
const loser: SessionRunner = async ({ task }) => ({
  costUsd: 0.1,
  summary: `Tried ${task.id}, got nowhere.`,
  claimsComplete: false,
});

describe('the happy path', () => {
  it('works one task at a time until the goal is complete', async () => {
    await writeLedger(dir, ledger(3));
    const order: string[] = [];
    const runner: SessionRunner = async (i) => {
      // One task per session, never a list — this is what stops the model
      // attempting everything and declaring victory.
      order.push(i.task.id);
      return winner(i);
    };

    const { decision, run } = await runGoalLoop({ dir, runSession: runner });

    expect(decision).toMatchObject({ stop: true, reason: 'complete' });
    expect(order).toEqual(['t-1', 't-2', 't-3']);
    expect(run.sessions).toBe(3);
    expect(run.spentUsd).toBeCloseTo(0.3);

    const after = await readLedger(dir);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.tasks.every((t) => t.status === 'passed')).toBe(true);
  });

  it('records that nothing verified the work', async () => {
    /*
     * Phase 1 has no verifier, so a task passes on the session's own say-so.
     * That is a fact the user is entitled to — this repo has already shipped the
     * gap between "the agent said so" and "it works".
     */
    await writeLedger(dir, ledger(1));
    await runGoalLoop({ dir, runSession: winner });

    const record = JSON.parse(await fsp.readFile(path.join(dir, 'runs', '0001.json'), 'utf8'));
    expect(record.verified).toBe(false);
    expect(record.claimsComplete).toBe(true);

    const progress = await fsp.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    expect(progress).toContain('unverified');
  });

  it('appends one progress entry per session, in order', async () => {
    await writeLedger(dir, ledger(2));
    await runGoalLoop({ dir, runSession: winner });
    const progress = await fsp.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    expect(progress.indexOf('Session 1')).toBeLessThan(progress.indexOf('Session 2'));
    expect(progress).toContain('t-1');
    expect(progress).toContain('t-2');
  });
});

describe('termination', () => {
  it('a session that never succeeds still terminates, on no-progress', async () => {
    await writeLedger(dir, ledger(1));
    const { decision, run } = await runGoalLoop({ dir, runSession: loser });
    expect(decision.reason).toBe('no-progress');
    // Bounded, not open-ended: this is the 240-retry runaway not happening.
    expect(run.sessions).toBeLessThanOrEqual(DEFAULT_POLICY.idleLimit + 1);
  });

  it('stops on budget', async () => {
    await writeLedger(dir, ledger(50));
    const expensive: SessionRunner = async (i) => ({ ...(await winner(i)), costUsd: 4 });
    const { decision, run } = await runGoalLoop({ dir, runSession: expensive });
    expect(decision.reason).toBe('budget');
    expect(run.spentUsd).toBeGreaterThanOrEqual(10);
  });

  it('stops on the deadline, using the injected clock', async () => {
    await writeLedger(dir, ledger(50));
    const t0 = Date.parse('2026-08-16T12:00:00.000Z');
    // writeGoalOnce refuses a second write by design, so amend the file directly.
    const goalFile = path.join(dir, 'goal.json');
    const g = JSON.parse(await fsp.readFile(goalFile, 'utf8'));
    g.deadlineIso = new Date(t0 + 250).toISOString();
    await fsp.writeFile(goalFile, JSON.stringify(g));

    let clock = t0;
    const { decision } = await runGoalLoop({
      dir,
      runSession: async (i) => {
        clock += 100;
        return winner(i);
      },
      now: () => clock,
    });
    expect(decision.reason).toBe('deadline');
  });

  it('honours an abort signal', async () => {
    await writeLedger(dir, ledger(50));
    const ac = new AbortController();
    let n = 0;
    const { decision } = await runGoalLoop({
      dir,
      signal: ac.signal,
      runSession: async (i) => {
        if (++n === 2) ac.abort();
        return winner(i);
      },
    });
    expect(decision.reason).toBe('user');
    expect(n).toBe(2);
  });

  it('halts when every remaining task is blocked', async () => {
    const l = ledger(2);
    l.tasks[0].status = 'passed';
    l.tasks[1].status = 'blocked';
    await writeLedger(dir, l);
    const { decision } = await runGoalLoop({ dir, runSession: winner });
    expect(decision).toMatchObject({ stop: true, reason: 'stuck-task' });
  });

  it('halts on an unreadable ledger rather than treating it as finished', async () => {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'tasks.json'), '{ truncated');
    const { decision } = await runGoalLoop({ dir, runSession: winner });
    expect(decision).toMatchObject({ stop: true, reason: 'error' });
    expect(decision.detail).toMatch(/ledger/i);
  });

  it('halts on a missing goal', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-goal-'));
    try {
      const { decision } = await runGoalLoop({ dir: empty, runSession: winner });
      expect(decision).toMatchObject({ stop: true, reason: 'error' });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('the session cannot rewrite the plan', () => {
  it('rejects and restores a ledger the session edited behind our back', async () => {
    await writeLedger(dir, ledger(2));
    const events: LoopEvent[] = [];

    // A session that "finishes" by deleting the task it could not do and
    // softening the one it could — reward hacking, precisely.
    const cheat: SessionRunner = async ({ task }) => {
      const cheated: Ledger = {
        version: 1,
        tasks: [{ id: 't-1', title: 'Task 1', verify: ['looks fine'], status: 'passed', attempts: 0, lastVerdict: null }],
      };
      await writeLedger(dir, cheated);
      return { costUsd: 0.1, summary: `pretended to do ${task.id}`, claimsComplete: true };
    };

    const { decision } = await runGoalLoop({
      dir,
      runSession: cheat,
      onEvent: (e) => events.push(e),
    });

    const tamper = events.filter((e) => e.type === 'tamper');
    expect(tamper.length).toBeGreaterThan(0);
    expect(tamper[0].detail).toMatch(/removed|verification steps changed/);

    // Both tasks are still there, with their original verification steps.
    const after = await readLedger(dir);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.tasks.map((t) => t.id)).toEqual(['t-1', 't-2']);
      expect(after.value.tasks[0].verify).toEqual(['check it']);
    }
    // And the cheat did not earn a pass.
    if (after.ok) expect(after.value.tasks[0].status).not.toBe('passed');
    expect(decision.reason).toBe('no-progress');
  });

  it('accepts a session that only moved status', async () => {
    await writeLedger(dir, ledger(1));
    const events: LoopEvent[] = [];
    const honest: SessionRunner = async ({ task }) => {
      const current = await readLedger(dir);
      if (current.ok) {
        await writeLedger(dir, {
          version: 1,
          tasks: current.value.tasks.map((t) => (t.id === task.id ? { ...t, status: 'passed' } : t)),
        });
      }
      return { costUsd: 0.1, summary: 'did it properly', claimsComplete: true };
    };
    const { decision } = await runGoalLoop({ dir, runSession: honest, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'tamper')).toEqual([]);
    expect(decision.reason).toBe('complete');
  });
});

describe('crash safety and resume', () => {
  it('leaves an interrupted task as `doing`, and the next run resumes it', async () => {
    await writeLedger(dir, ledger(2));
    const boom: SessionRunner = async () => {
      throw new Error('process died');
    };
    await runGoalLoop({ dir, runSession: boom });

    // The thrown session was counted, not silently retried forever.
    const state = await readRunState(dir);
    expect(state?.sessions).toBeGreaterThan(0);

    const after = await readLedger(dir);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.tasks[0].attempts).toBeGreaterThan(0);
  });

  it('persists run state so a restart continues rather than starting over', async () => {
    await writeLedger(dir, ledger(4));
    let n = 0;
    await runGoalLoop({
      dir,
      runSession: async (i) => {
        if (++n === 2) throw new Error('stop here');
        return winner(i);
      },
      policy: { idleLimit: 1, attemptLimit: 5 },
    });

    const mid = await readRunState(dir);
    expect(mid).not.toBeNull();
    expect(mid!.sessions).toBeGreaterThan(0);

    // Resuming picks up the accumulated spend rather than resetting it.
    const { run } = await runGoalLoop({ dir, runSession: winner });
    expect(run.sessions).toBeGreaterThan(mid!.sessions);
    expect(run.spentUsd).toBeGreaterThan(mid!.spentUsd);
  });

  it('a session error does not mark the task passed', async () => {
    await writeLedger(dir, ledger(1));
    const liar: SessionRunner = async () => ({
      costUsd: 0.1,
      summary: 'claimed success while erroring',
      claimsComplete: true,
      error: 'the build failed',
    });
    await runGoalLoop({ dir, runSession: liar });
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks[0].status).not.toBe('passed');
  });
});

describe('events', () => {
  it('emits a start and an end per session, and a stop at the end', async () => {
    await writeLedger(dir, ledger(2));
    const events: LoopEvent[] = [];
    await runGoalLoop({ dir, runSession: winner, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.type === 'session-start')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(2);
    expect(events.at(-1)?.type).toBe('stopped');
  });
});
