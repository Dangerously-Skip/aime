import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRun, stopRun, runStatus, isRunning, awaitRun, clearRuns } from './runner';
import { writeGoalOnce, writeLedger, type Ledger, type Goal } from './ledger';
import type { SessionRunner } from './goal-loop';

let dir: string;

beforeEach(async () => {
  clearRuns();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runner-'));
  await writeGoalOnce(dir, {
    version: 1,
    objective: 'Ship it',
    acceptanceCriteria: [],
    budgetUsd: 10,
    deadlineIso: null,
    sessionCap: 20,
    createdAt: '2026-08-16T00:00:00.000Z',
  } satisfies Goal);
});
afterEach(() => {
  clearRuns();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ledger = (n = 2): Ledger => ({
  version: 1,
  tasks: Array.from({ length: n }, (_, i) => ({
    id: `t-${i + 1}`, title: `Task ${i + 1}`, verify: [], status: 'todo' as const, attempts: 0, lastVerdict: null,
  })),
});

const winner: SessionRunner = async () => ({ costUsd: 0.1, summary: 'done', claimsComplete: true });

/** A session that blocks until released — lets a test observe a live run. */
function gated() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const runner: SessionRunner = async () => {
    await gate;
    return { costUsd: 0.1, summary: 'done', claimsComplete: true };
  };
  return { runner, release };
}

describe('lifecycle', () => {
  it('runs to completion and reports the decision', async () => {
    await writeLedger(dir, ledger(2));
    expect(startRun({ conversationId: 'c1', dir, runSession: winner })).toEqual({ ok: true });
    await awaitRun('c1');

    const s = await runStatus('c1', dir);
    expect(s.running).toBe(false);
    expect(s.decision).toMatchObject({ reason: 'complete' });
    expect(s.run?.sessions).toBe(2);
  });

  it('refuses a second run for the same conversation', async () => {
    /*
     * Two loops over one directory would interleave ledger writes and each would
     * read the other's work as tampering.
     */
    await writeLedger(dir, ledger(2));
    const { runner, release } = gated();
    startRun({ conversationId: 'c1', dir, runSession: runner });
    expect(isRunning('c1')).toBe(true);

    const second = startRun({ conversationId: 'c1', dir, runSession: winner });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already in progress/);

    release();
    await awaitRun('c1');
    // And once it is done, a new run is allowed.
    expect(startRun({ conversationId: 'c1', dir, runSession: winner }).ok).toBe(true);
    await awaitRun('c1');
  });

  it('allows concurrent runs in different conversations', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runner2-'));
    try {
      await writeGoalOnce(dir2, {
        version: 1, objective: 'Other', acceptanceCriteria: [], budgetUsd: 1,
        deadlineIso: null, sessionCap: 5, createdAt: '2026-08-16T00:00:00.000Z',
      } satisfies Goal);
      await writeLedger(dir, ledger(1));
      await writeLedger(dir2, ledger(1));
      expect(startRun({ conversationId: 'c1', dir, runSession: winner }).ok).toBe(true);
      expect(startRun({ conversationId: 'c2', dir: dir2, runSession: winner }).ok).toBe(true);
      await Promise.all([awaitRun('c1'), awaitRun('c2')]);
      expect((await runStatus('c1', dir)).decision?.reason).toBe('complete');
      expect((await runStatus('c2', dir2)).decision?.reason).toBe('complete');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('stops a live run on request', async () => {
    await writeLedger(dir, ledger(20));
    let sessions = 0;
    const runner: SessionRunner = async () => {
      sessions++;
      if (sessions === 2) stopRun('c1');
      return { costUsd: 0.01, summary: 'x', claimsComplete: true };
    };
    startRun({ conversationId: 'c1', dir, runSession: runner });
    await awaitRun('c1');
    const s = await runStatus('c1', dir);
    expect(s.decision?.reason).toBe('user');
    expect(sessions).toBe(2);
  });

  it('stopRun on a finished or unknown run reports false rather than throwing', async () => {
    expect(stopRun('never-existed')).toBe(false);
    await writeLedger(dir, ledger(1));
    startRun({ conversationId: 'c1', dir, runSession: winner });
    await awaitRun('c1');
    expect(stopRun('c1')).toBe(false);
  });

  it('a loop that throws marks the run finished rather than wedging the slot', async () => {
    // Otherwise a single bug would block every later start for that conversation.
    await writeLedger(dir, ledger(1));
    const exploding: SessionRunner = () => {
      throw new Error('synchronous boom');
    };
    startRun({ conversationId: 'c1', dir, runSession: exploding });
    await awaitRun('c1');
    expect(isRunning('c1')).toBe(false);
    expect(startRun({ conversationId: 'c1', dir, runSession: winner }).ok).toBe(true);
    await awaitRun('c1');
  });
});

describe('status reads from disk, not just memory', () => {
  it('reports a run this process never started', async () => {
    /*
     * The property that makes a run survive a restart: everything the panel
     * needs is on disk, and the registry only adds "is it going right now".
     */
    await writeLedger(dir, ledger(2));
    startRun({ conversationId: 'c1', dir, runSession: winner });
    await awaitRun('c1');

    // Simulate a process restart — the registry is gone, the files are not.
    clearRuns();

    const s = await runStatus('c1', dir);
    expect(s.running).toBe(false);
    expect(s.goal?.objective).toBe('Ship it');
    expect(s.ledger?.tasks).toHaveLength(2);
    expect(s.run?.sessions).toBe(2);
    expect(s.run?.spentUsd).toBeCloseTo(0.2);
  });

  it('reports an empty directory without throwing', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-empty-'));
    try {
      const s = await runStatus('nobody', empty);
      expect(s).toMatchObject({ running: false, goal: null, ledger: null, run: null });
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('surfaces live progress while a run is going', async () => {
    await writeLedger(dir, ledger(3));
    const { runner, release } = gated();
    let started = 0;
    startRun({
      conversationId: 'c1',
      dir,
      runSession: async (i) => {
        started++;
        return runner(i);
      },
    });
    /*
     * Poll for the first session rather than sleeping a fixed 20ms and hoping.
     * The sleep was a fast-laptop assumption: it failed once in a full-suite run
     * on a loaded machine and passed alone every time, which is the signature of
     * a timing assumption rather than a bug. Same class as the 30s testTimeout
     * in vitest.config.ts, and the fix is the same shape — wait for the
     * condition, not for the clock.
     */
    const deadline = Date.now() + 5_000;
    while (started === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const s = await runStatus('c1', dir);
    expect(s.running).toBe(true);
    expect(started).toBe(1);
    expect(s.events.some((e) => e.type === 'session-start')).toBe(true);

    release();
    await awaitRun('c1');
  });
});
