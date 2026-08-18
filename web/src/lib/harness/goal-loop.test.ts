import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGoalLoop, readRunState, type SessionRunner, type LoopEvent } from './goal-loop';
import { writeGoalOnce, writeLedger, readLedger, PROGRESS_FILE, type Ledger, type Goal } from './ledger';
import { DEFAULT_POLICY } from './stop';
import { MAX_REVISIONS } from './goal-loop';
import type { Verifier } from './verifier';
import { readQuestion, answerQuestion } from './question';

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

describe('the verifier gates the pass', () => {
  const passing: Verifier = async () => ({
    passed: true, missing: [], evidence: ['ran the check'], at: 'now',
  });
  const rejecting: Verifier = async () => ({
    passed: false, missing: ['step 2 still fails'], evidence: ['ran it'], at: 'now',
  });

  it('a claim the verifier rejects does NOT pass the task', async () => {
    /*
     * The whole point of phase 2. Before this, a session saying it was done was
     * the end of the matter — which is how "all 9 videos are properly embedded"
     * would have become a passed task with nine broken embeds behind it.
     */
    await writeLedger(dir, ledger(1));
    const { decision } = await runGoalLoop({ dir, runSession: winner, verify: rejecting });

    const after = await readLedger(dir);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.tasks[0].status).not.toBe('passed');
      expect(after.value.tasks[0].lastVerdict?.passed).toBe(false);
    }
    expect(decision.reason).toBe('no-progress');
  });

  it('a claim the verifier accepts passes, and records the verdict', async () => {
    await writeLedger(dir, ledger(1));
    const { decision } = await runGoalLoop({ dir, runSession: winner, verify: passing });
    expect(decision.reason).toBe('complete');

    const after = await readLedger(dir);
    if (after.ok) {
      expect(after.value.tasks[0].status).toBe('passed');
      expect(after.value.tasks[0].lastVerdict?.evidence).toEqual(['ran the check']);
    }
    const record = JSON.parse(await fsp.readFile(path.join(dir, 'runs', '0001.json'), 'utf8'));
    expect(record.verified).toBe(true);
  });

  it('feeds the rejection into the next attempt VERBATIM', async () => {
    // Paraphrasing feedback is how a loop repeats the same failure in new words.
    await writeLedger(dir, ledger(1));
    const seen: string[][] = [];
    await runGoalLoop({
      dir,
      runSession: async (i) => { seen.push(i.missing); return winner(i); },
      verify: rejecting,
    });
    // First attempt has nothing; later ones carry the verifier's exact words.
    expect(seen[0]).toEqual([]);
    expect(seen.slice(1).some((m) => m.includes('step 2 still fails'))).toBe(true);
  });

  it('does not verify a session that did not claim completion', async () => {
    // Checking work nobody says is finished costs a session to learn what we
    // were already told.
    await writeLedger(dir, ledger(1));
    let verifierRuns = 0;
    await runGoalLoop({
      dir,
      runSession: loser,
      verify: async () => { verifierRuns++; return { passed: true, missing: [], evidence: ['x'], at: 'now' }; },
    });
    expect(verifierRuns).toBe(0);
  });

  it('a verifier that throws fails the task rather than passing it', async () => {
    await writeLedger(dir, ledger(1));
    await runGoalLoop({
      dir,
      runSession: winner,
      verify: async () => { throw new Error('verifier crashed'); },
    });
    const after = await readLedger(dir);
    if (after.ok) {
      expect(after.value.tasks[0].status).not.toBe('passed');
      expect(after.value.tasks[0].lastVerdict?.missing[0]).toMatch(/failed to run/i);
    }
  });

  it('without a verifier the pass still happens, and is recorded as unverified', async () => {
    await writeLedger(dir, ledger(1));
    await runGoalLoop({ dir, runSession: winner });
    const record = JSON.parse(await fsp.readFile(path.join(dir, 'runs', '0001.json'), 'utf8'));
    expect(record.verified).toBe(false);
    const progress = await fsp.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    expect(progress).toContain('unverified');
  });

  it('says "verified" in the log when something checked it', async () => {
    await writeLedger(dir, ledger(1));
    await runGoalLoop({ dir, runSession: winner, verify: passing });
    const progress = await fsp.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    expect(progress).toContain('passed (verified)');
    expect(progress).not.toContain('unverified');
  });
});

describe('parking on a question', () => {
  const asks: SessionRunner = async () => ({
    costUsd: 0.1,
    summary: 'I need to know which database.',
    claimsComplete: false,
    question: 'Postgres or SQLite?',
  });

  it('a session that ASKS halts the run instead of failing the task', async () => {
    /*
     * The distinction the whole phase turns on. "I did not finish" gets retried;
     * "which database do you want" retried forty times is the runaway this
     * design exists to prevent, and no amount of retrying produces the answer.
     */
    await writeLedger(dir, ledger(1));
    const { decision, run } = await runGoalLoop({ dir, runSession: asks });
    expect(decision).toMatchObject({ stop: true, reason: 'awaiting-answer' });
    expect(decision.detail).toContain('Postgres or SQLite?');
    expect(run.sessions).toBe(1); // it stopped, it did not retry
  });

  it('does not burn an attempt on a question', async () => {
    // Otherwise a question would eat through the stuck-task limit.
    await writeLedger(dir, ledger(1));
    await runGoalLoop({ dir, runSession: asks });
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks[0].attempts).toBe(0);
  });

  it('stays parked across restarts until answered — no timer', async () => {
    /*
     * The reason pending-questions could not be reused: it gives five minutes
     * and treats silence as a refusal. A run continuing overnight would have the
     * question expire and the task fail for a reason that was never a reason.
     */
    await writeLedger(dir, ledger(1));
    await runGoalLoop({ dir, runSession: asks });

    // A completely fresh loop, as after an app restart.
    const second = await runGoalLoop({ dir, runSession: winner });
    expect(second.decision.reason).toBe('awaiting-answer');
    const third = await runGoalLoop({ dir, runSession: winner });
    expect(third.decision.reason).toBe('awaiting-answer');
  });

  it('resumes once answered, and hands the answer to the next session', async () => {
    // TWO tasks: answering now CLOSES the asking task, so a single-task ledger
    // would be complete and no session would run to receive the answer.
    await writeLedger(dir, ledger(2));
    await runGoalLoop({ dir, runSession: asks });

    const q = await readQuestion(dir);
    expect(q).not.toBeNull();
    await answerQuestion(dir, q!.id, 'Postgres', () => 'now');

    const seen: (string | null | undefined)[] = [];
    const { decision } = await runGoalLoop({
      dir,
      runSession: async (i) => { seen.push(i.answer); return winner(i); },
    });
    expect(decision.reason).toBe('complete');
    expect(seen[0]).toBe('Postgres');
  });

  it('consumes the answer exactly once', async () => {
    // Leaving it would make a later session act on a decision already applied.
    await writeLedger(dir, ledger(3));
    await runGoalLoop({ dir, runSession: asks });
    const q = await readQuestion(dir);
    await answerQuestion(dir, q!.id, 'Postgres', () => 'now');

    const seen: (string | null | undefined)[] = [];
    await runGoalLoop({ dir, runSession: async (i) => { seen.push(i.answer); return winner(i); } });
    expect(seen[0]).toBe('Postgres');
    expect(seen.slice(1).every((a) => !a)).toBe(true);
  });

  it('the user’s stop still wins over a parked question', async () => {
    await writeLedger(dir, ledger(1));
    await runGoalLoop({ dir, runSession: asks });
    const ac = new AbortController();
    ac.abort();
    const { decision } = await runGoalLoop({ dir, runSession: winner, signal: ac.signal });
    expect(decision.reason).toBe('user');
  });
});

describe('plan revision', () => {
  const proposes = (revision: import('./revision').Revision): SessionRunner => async () => ({
    costUsd: 0.1, summary: 'found the plan wrong', claimsComplete: false, revision,
  });

  it('ADDS work immediately — finding more to do can only lengthen a run', async () => {
    await writeLedger(dir, ledger(1));
    await runGoalLoop({
      dir,
      runSession: proposes({ add: [{ title: 'Write a fixture', verify: ['fixture.json exists'] }], remove: [], reason: 'the test needs one' }),
      policy: { idleLimit: 1, attemptLimit: 5 },
    });
    const after = await readLedger(dir);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.tasks.map((t) => t.title)).toContain('Write a fixture');
      // A fresh id past the highest used, never a reused one.
      expect(after.value.tasks[1].id).toBe('t-002');
    }
  });

  it('REMOVING stops the run and asks, rather than just happening', async () => {
    /*
     * Dropping work shrinks what "done" means — the move reward hacking makes.
     * Phase 3's parking is what makes asking possible without a timeout.
     */
    await writeLedger(dir, ledger(2));
    const { decision } = await runGoalLoop({
      dir,
      runSession: proposes({ add: [], remove: ['t-2'], reason: 'out of scope' }),
    });
    expect(decision).toMatchObject({ stop: true, reason: 'awaiting-answer' });
    expect(decision.detail).toContain('Task 2');

    // Nothing was dropped while waiting.
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks.map((t) => t.id)).toEqual(['t-1', 't-2']);

    const q = await readQuestion(dir);
    expect(q?.options).toContain('Allow');
  });

  it('applies additions even when the same proposal has a removal to approve', async () => {
    await writeLedger(dir, ledger(2));
    await runGoalLoop({
      dir,
      runSession: proposes({ add: [{ title: 'Extra', verify: ['x'] }], remove: ['t-2'], reason: 'r' }),
    });
    const after = await readLedger(dir);
    if (after.ok) {
      expect(after.value.tasks.map((t) => t.title)).toContain('Extra');
      expect(after.value.tasks.map((t) => t.id)).toContain('t-2'); // still waiting
    }
  });

  it('REFUSES to remove a task that already passed, without asking', async () => {
    // Approval is for changing the plan, not for erasing evidence.
    const l = ledger(2);
    l.tasks[0].status = 'passed';
    await writeLedger(dir, l);
    const { decision } = await runGoalLoop({
      dir,
      runSession: proposes({ add: [], remove: ['t-1'], reason: 'tidier' }),
      policy: { idleLimit: 1, attemptLimit: 5 },
    });
    expect(decision.reason).not.toBe('awaiting-answer');
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks.map((t) => t.id)).toContain('t-1');
  });

  it('CAPS how many times one run may revise its plan', async () => {
    /*
     * Found by a test, not by reasoning. Adding a task changes the ledger's
     * state hash, so the idle counter resets — a session that proposes an
     * addition every time never trips the no-progress detector and can look busy
     * until the budget runs out.
     */
    await writeLedger(dir, ledger(1));
    /*
     * The session must SUCCEED as well as revise. A failing one trips the
     * stuck-task limit after five attempts, so the cap is never reached and the
     * test proves nothing — which is exactly what the first version did.
     */
    const succeedsAndAdds: SessionRunner = async () => ({
      costUsd: 0.01,
      summary: 'done, and found more',
      claimsComplete: true,
      revision: { add: [{ title: 'Another', verify: ['x'] }], remove: [], reason: 'more work' },
    });
    const { run } = await runGoalLoop({ dir, runSession: succeedsAndAdds });
    const after = await readLedger(dir);
    if (after.ok) {
      const added = after.value.tasks.filter((t) => t.title === 'Another').length;
      expect(added).toBeLessThanOrEqual(MAX_REVISIONS);
    }
    expect(run.sessions).toBeLessThan(30);
  });

  it('records the plan change in the progress log', async () => {
    await writeLedger(dir, ledger(1));
    await runGoalLoop({
      dir,
      runSession: proposes({ add: [{ title: 'Extra', verify: ['x'] }], remove: [], reason: 'needed a fixture' }),
      policy: { idleLimit: 1, attemptLimit: 5 },
    });
    const progress = await fsp.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    expect(progress).toMatch(/\*\*Plan:\*\*/);
    expect(progress).toContain('needed a fixture');
  });
});

describe('regressions the review found', () => {
  it('a session with no verdict does not WIPE the last rejection', async () => {
    // The missing list is what the next attempt reads; overwriting it with null
    // loses the reason the previous attempt failed.
    await writeLedger(dir, ledger(1));
    const l = await readLedger(dir);
    if (l.ok) {
      l.value.tasks[0].lastVerdict = { passed: false, missing: ['still broken'], evidence: [], at: 'then' };
      await writeLedger(dir, l.value);
    }
    await runGoalLoop({ dir, runSession: loser, policy: { idleLimit: 1, attemptLimit: 5 } });
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks[0].lastVerdict?.missing).toEqual(['still broken']);
  });

  it('counts revisions per RUN, surviving a park', async () => {
    // A loop-local counter resets on every park or restart, so a run could
    // revise indefinitely by pausing between edits.
    await writeLedger(dir, ledger(1));
    const adds: SessionRunner = async () => ({
      costUsd: 0.01, summary: 'more', claimsComplete: true,
      revision: { add: [{ title: 'Extra', verify: ['x'] }], remove: [], reason: 'r' },
    });
    const first = await runGoalLoop({ dir, runSession: adds });
    expect(first.run.revisions).toBeGreaterThan(0);
    const state = await readRunState(dir);
    expect(state?.revisions).toBe(first.run.revisions);

    /*
     * And a SECOND invocation must not get a fresh allowance.
     *
     * Running the loop once proved nothing — a loop-local counter looks
     * identical. The bug is that a run could revise indefinitely by pausing
     * between edits, so the test has to resume after the cap is reached.
     */
    expect(first.run.revisions).toBe(MAX_REVISIONS);
    const beforeCount = (await readLedger(dir)).ok
      ? ((await readLedger(dir)) as { ok: true; value: Ledger }).value.tasks.length
      : 0;

    // Give it something to do, so the loop actually runs a session.
    const l2 = await readLedger(dir);
    if (l2.ok) {
      l2.value.tasks.push({ id: 't-900', title: 'More', verify: ['x'], status: 'todo', attempts: 0, lastVerdict: null });
      await writeLedger(dir, l2.value);
    }

    const second = await runGoalLoop({ dir, runSession: adds });
    expect(second.run.revisions).toBe(MAX_REVISIONS); // no fresh allowance
    const after = await readLedger(dir);
    if (after.ok) {
      // One task added by hand, none by a revision past the cap.
      expect(after.value.tasks.length).toBe(beforeCount + 1);
    }
  });

  it('applies an APPROVED removal when the run resumes', async () => {
    /*
     * "Allow" was a no-op: the answer was recorded and the removal never
     * happened, so the run carried on with the task the user had agreed to drop.
     */
    await writeLedger(dir, ledger(2));
    const proposes: SessionRunner = async () => ({
      costUsd: 0.01, summary: 'drop it', claimsComplete: false,
      revision: { add: [], remove: ['t-2'], reason: 'out of scope' },
    });
    await runGoalLoop({ dir, runSession: proposes });

    const q = await readQuestion(dir);
    expect(q?.revision).toBeTruthy();
    await answerQuestion(dir, q!.id, 'Allow', () => 'now');

    await runGoalLoop({ dir, runSession: winner });
    const after = await readLedger(dir);
    if (after.ok) {
      expect(after.value.tasks.map((t) => t.id)).not.toContain('t-2');
      expect(after.value.retiredIds).toContain('t-2');
    }
  });

  it('does NOT remove when the user declines', async () => {
    await writeLedger(dir, ledger(2));
    const proposes: SessionRunner = async () => ({
      costUsd: 0.01, summary: 'drop it', claimsComplete: false,
      revision: { add: [], remove: ['t-2'], reason: 'r' },
    });
    await runGoalLoop({ dir, runSession: proposes });
    const q = await readQuestion(dir);
    await answerQuestion(dir, q!.id, 'Keep the plan as it is', () => 'now');
    await runGoalLoop({ dir, runSession: winner });
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks.map((t) => t.id)).toContain('t-2');
  });
});

describe('an unreachable model is not a failed attempt', () => {
  it('halts instead of burning the task through the stuck limit', async () => {
    /*
     * A real run died six times on "Not logged in · Please run /login" — the
     * resume path had no credentials — and every one counted against the task
     * until stuck-task killed a run that had never actually tried. Attempts
     * measure whether the WORK is converging; a session that could not start
     * has said nothing about that.
     */
    await writeLedger(dir, ledger(1));
    let sessions = 0;
    const unauthorised: SessionRunner = async () => {
      sessions++;
      return { costUsd: 0, summary: 'x', claimsComplete: false, error: 'Not logged in · Please run /login' };
    };
    const { decision } = await runGoalLoop({ dir, runSession: unauthorised });

    expect(decision.reason).toBe('error');
    expect(decision.detail).toMatch(/could not reach the model/i);
    expect(sessions).toBe(1); // stopped at once, not five times
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks[0].attempts).toBe(0);
  });

  it('an ordinary failure still counts', async () => {
    await writeLedger(dir, ledger(1));
    const failing: SessionRunner = async () => ({
      costUsd: 0.01, summary: 'tried', claimsComplete: false, error: 'the build failed',
    });
    await runGoalLoop({ dir, runSession: failing, policy: { idleLimit: 2, attemptLimit: 5 } });
    const after = await readLedger(dir);
    if (after.ok) expect(after.value.tasks[0].attempts).toBeGreaterThan(0);
  });
});

describe('the question the user sees', () => {
  it('does not leak the protocol markers into its context', async () => {
    /*
     * Slicing the summary's tail dragged the raw syntax into the user's face:
     * "…STATUS: QUESTION Which total should I compute? || gross | net". That is
     * how the session talks to the loop, not something to show someone being
     * asked a question.
     */
    await writeLedger(dir, ledger(1));
    const asks: SessionRunner = async () => ({
      costUsd: 0.01,
      summary: 'I need your answer to proceed. STATUS: QUESTION Which total? || gross | net',
      claimsComplete: false,
      question: 'Which total?',
      questionOptions: ['gross', 'net'],
    });
    await runGoalLoop({ dir, runSession: asks });
    const q = await readQuestion(dir);
    expect(q?.context).not.toMatch(/STATUS: QUESTION/);
    expect(q?.context).not.toContain('||');
    expect(q?.context).toContain('I need your answer to proceed.');
    expect(q?.options).toEqual(['gross', 'net']);
  });
});

describe('a task whose job is to ASK', () => {
  it('is finished by the answer, not by more work', async () => {
    /*
     * A real run asked twice. The planner made "Ask the user whether to compute
     * gross or net" a task of its own — reasonably — but no amount of further
     * work can complete it, so the resumed session read the answer as context,
     * found the task still open, and asked again. It would have asked until the
     * attempt limit killed it.
     */
    await writeLedger(dir, ledger(2));
    const asks: SessionRunner = async () => ({
      costUsd: 0.01, summary: 'need a decision', claimsComplete: false,
      question: 'gross or net?', questionOptions: ['gross', 'net'],
    });
    await runGoalLoop({ dir, runSession: asks });

    const q = await readQuestion(dir);
    expect(q?.taskId).toBe('t-1');
    await answerQuestion(dir, q!.id, 'net', () => 'now');

    // The next session must be given the SECOND task, not the answered one.
    const worked: string[] = [];
    await runGoalLoop({
      dir,
      runSession: async (i) => { worked.push(i.task.id); return winner(i); },
    });
    expect(worked).not.toContain('t-1');

    const after = await readLedger(dir);
    if (after.ok) {
      const asked = after.value.tasks.find((t) => t.id === 't-1')!;
      expect(asked.status).toBe('passed');
      // And the answer is the evidence, so the record says why it passed.
      expect(asked.lastVerdict?.evidence.join(' ')).toContain('net');
    }
  });

  it('does not close a task when the answer was a plan APPROVAL', async () => {
    // Those questions are about the plan, not about a task's own work.
    await writeLedger(dir, ledger(2));
    const proposes: SessionRunner = async () => ({
      costUsd: 0.01, summary: 'drop it', claimsComplete: false,
      revision: { add: [], remove: ['t-2'], reason: 'out of scope' },
    });
    await runGoalLoop({ dir, runSession: proposes });
    const q = await readQuestion(dir);
    await answerQuestion(dir, q!.id, 'Allow', () => 'now');
    await runGoalLoop({ dir, runSession: winner });
    const after = await readLedger(dir);
    if (after.ok) {
      // t-1 raised the question but was not itself answered-away.
      expect(after.value.tasks.find((t) => t.id === 't-1')?.lastVerdict?.evidence.join(' ') ?? '')
        .not.toContain('Answered by the user');
    }
  });
});
