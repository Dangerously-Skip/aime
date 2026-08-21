import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionRunner } from './session';
import { startRun, runStatus, awaitRun, clearRuns } from './runner';
import { writeGoalOnce, writeLedger } from './ledger';

/**
 * A RUNNING RUN MUST LOOK DIFFERENT FROM A DEAD ONE.
 *
 * Loop events fire at SESSION boundaries — start, end, verify, park, stop. A
 * session is many minutes and can be a hundred tool calls, and between those
 * boundaries the run emitted nothing at all.
 *
 * On screen that is indistinguishable from a hang. A real run sat showing
 * "session 1 · t-001" while making 94 tool calls against Bash, Read and
 * FetchUrl, and was reasonably reported as having stopped after making its plan.
 *
 * That is worse than an ordinary bug: a run you cannot tell apart from a dead
 * one makes every other problem in the system unreadable, because the first
 * question about any symptom is "is it still going?".
 */

let dir = '';

/** A complete SessionInput — the prompt builder reads `task.verify`. */
const input = () => ({
  dir,
  sessionIndex: 1,
  missing: [],
  goal: { objective: 'x', acceptanceCriteria: ['it works'] },
  task: { id: 't-001', title: 'do it', status: 'doing', verify: ['it works'] },
}) as never;

/** A provider stream that calls some tools and then answers. */
async function* stream(tools: string[]) {
  for (const name of tools) {
    yield { type: 'tool_use', name };
  }
  yield { type: 'text', content: 'done' };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-activity-'));
  clearRuns();
});

afterEach(async () => {
  clearRuns();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('the session runner reports each tool', () => {
  it('calls onActivity once per tool_use, with the name', async () => {
    const seen: string[] = [];
    const run = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      onActivity: (t) => seen.push(t),
      query: () => stream(['Bash', 'Read', 'Bash']),
    });
    await run(input());
    expect(seen).toEqual(['Bash', 'Read', 'Bash']);
  });

  it('does not report text or usage chunks as tools', async () => {
    const seen: string[] = [];
    const run = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      onActivity: (t) => seen.push(t),
      query: async function* () {
        yield { type: 'text', content: 'thinking' };
        yield { type: 'usage', totalCostUsd: 0.01 };
        yield { type: 'tool_use', name: 'Grep' };
      },
    });
    await run(input());
    expect(seen).toEqual(['Grep']);
  });

  it('runs fine with no onActivity at all', async () => {
    // Every existing caller and every test constructs one without it.
    const run = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      query: () => stream(['Bash']),
    });
    await expect(run(input())).resolves.toBeTruthy();
  });
});

describe('the run record carries a pulse', () => {
  /** Start a run whose session reports the given tools, and read its status. */
  async function runWith(tools: string[]) {
    let report: ((t: string) => void) | null = null;
    const runSession = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      onActivity: (t) => report?.(t),
      query: () => stream(tools),
    });
    const started = startRun({
      conversationId: 'conv',
      dir,
      runSession,
      onActivitySink: (r) => { report = r; },
    });
    expect(started.ok).toBe(true);
    return { report: () => report };
  }

  it('counts tools and remembers the latest, WHILE the run is live', async () => {
    /*
     * Read mid-session, which is the only moment that matters: the pulse exists
     * to be seen during the minutes between loop events. A run with no goal on
     * disk finishes instantly and correctly reports no pulse, so the session is
     * held open here until the assertion has run.
     */
    await writeGoalOnce(dir, {
      version: 1,
      objective: 'Ship the thing',
      acceptanceCriteria: ['it works'],
      budgetUsd: 10,
      deadlineIso: null,
      sessionCap: 20,
      createdAt: '2026-08-16T00:00:00.000Z',
    } as never);
    await writeLedger(dir, {
      version: 1,
      tasks: [{ id: 't-1', title: 'Task 1', status: 'todo', verify: ['done'], attempts: 0, notes: [] }],
    } as never);

    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let report: ((t: string) => void) | null = null;

    const runSession = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      onActivity: (t) => report?.(t),
      query: async function* () {
        yield { type: 'tool_use', name: 'Bash' };
        yield { type: 'tool_use', name: 'Read' };
        yield { type: 'tool_use', name: 'Bash' };
        await held;                       // the session is still in flight here
        yield { type: 'text', content: 'done' };
      },
    });
    startRun({
      conversationId: 'conv',
      dir,
      runSession,
      onActivitySink: (r) => { report = r; },
    });

    // Let the three tool chunks flow before reading.
    for (let i = 0; i < 20 && (await runStatus('conv', dir)).activity?.count !== 3; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const status = await runStatus('conv', dir);
    expect(status.running).toBe(true);
    expect(status.activity?.count).toBe(3);
    expect(status.activity?.tool).toBe('Bash');   // the LATEST, not the first
    expect(status.activity?.at).toBeGreaterThan(0);

    release();
    await awaitRun('conv');
  });

  it('is null before any tool has run', async () => {
    await runWith([]);
    const status = await runStatus('conv', dir);
    expect(status.activity).toBeNull();
  });

  it('is null once the run has finished', async () => {
    /*
     * A finished run has no pulse. Showing the last tool it happened to call
     * would read as still working, which is the exact confusion this exists to
     * remove — in the opposite direction.
     */
    const { report } = await runWith([]);
    report()!('Bash');
    await awaitRun('conv');
    const status = await runStatus('conv', dir);
    expect(status.activity).toBeNull();
  });

  it('is null for a conversation with no run at all', async () => {
    const status = await runStatus('never-started', dir);
    expect(status.activity).toBeNull();
  });
});
