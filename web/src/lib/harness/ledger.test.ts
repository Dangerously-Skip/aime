import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  harnessDir,
  parseLedger,
  parseGoal,
  readLedger,
  writeLedger,
  readGoal,
  writeGoalOnce,
  applySessionUpdate,
  illegalChanges,
  ledgerStateHash,
  nextTask,
  isComplete,
  appendProgress,
  ensureGitignored,
  listRuns,
  currentRunIndex,
  nextRunIndex,
  LEDGER_FILE,
  PROGRESS_FILE,
  type Ledger,
  type Goal,
} from './ledger';

/**
 * A REAL directory, not a mocked fs.
 *
 * This module's whole job is that state survives a session boundary and cannot
 * be quietly rewritten by the agent between them. Both of those are properties
 * of the filesystem, so a fake one would be asserting on itself.
 */
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ledger-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const ledger = (): Ledger => ({
  version: 1,
  tasks: [
    { id: 't-1', title: 'Serve previews over http', verify: ['fetch the URL', 'expect 200'], status: 'todo', attempts: 0, lastVerdict: null },
    { id: 't-2', title: 'Video layout fits the slide', verify: ['no overflow'], status: 'todo', attempts: 0, lastVerdict: null },
  ],
});

const goal = (): Goal => ({
  version: 1,
  objective: 'Make the deck work',
  acceptanceCriteria: ['every embed plays'],
  budgetUsd: 5,
  deadlineIso: null,
  sessionCap: 20,
  createdAt: '2026-08-16T00:00:00.000Z',
});

describe('paths', () => {
  it('puts state under the working folder, not somewhere global', () => {
    expect(harnessDir('/tmp/proj')).toBe(path.join('/tmp/proj', '.aime', 'harness'));
  });
});

describe('round trip', () => {
  it('survives write and read', async () => {
    await writeLedger(dir, ledger());
    const back = await readLedger(dir);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual(ledger());
  });

  it('reports a missing ledger rather than inventing an empty one', async () => {
    const r = await readLedger(dir);
    expect(r).toEqual({ ok: false, error: 'no ledger' });
  });
});

describe('parsing refuses rather than degrades', () => {
  it('rejects invalid JSON', () => {
    const r = parseLedger('{ not json');
    expect(r.ok).toBe(false);
  });

  it('rejects a truncated ledger instead of returning zero tasks', () => {
    /*
     * The failure this prevents: an empty ledger reads as "no tasks", which the
     * loop takes for "the goal is complete". A half-written file would end the
     * run and report success.
     */
    const full = JSON.stringify(ledger());
    const r = parseLedger(full.slice(0, full.length / 2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });

  it('rejects an unknown version', () => {
    expect(parseLedger(JSON.stringify({ version: 99, tasks: [] })).ok).toBe(false);
  });

  it('rejects duplicate task ids, which would make a patch ambiguous', () => {
    const dupe = { version: 1, tasks: [ledger().tasks[0], ledger().tasks[0]] };
    const r = parseLedger(JSON.stringify(dupe));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate/);
  });

  it('rejects an invalid status rather than coercing it', () => {
    const bad = ledger();
    (bad.tasks[0] as unknown as Record<string, unknown>).status = 'done';
    expect(parseLedger(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects a goal with no objective', () => {
    expect(parseGoal(JSON.stringify({ version: 1, objective: '  ' })).ok).toBe(false);
  });
});

describe('the goal may not be rewritten', () => {
  it('writes once and refuses the second write', async () => {
    expect((await writeGoalOnce(dir, goal())).ok).toBe(true);

    const rewritten = { ...goal(), objective: 'Do something much easier' };
    const second = await writeGoalOnce(dir, rewritten);
    expect(second.ok).toBe(false);

    // And the original survived — refusing must not mean "wrote it anyway".
    const back = await readGoal(dir);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.objective).toBe('Make the deck work');
  });
});

describe('applySessionUpdate — the sanctioned path', () => {
  it('moves status, attempts and verdict', () => {
    const r = applySessionUpdate(ledger(), [
      { id: 't-1', status: 'passed', attempts: 2, lastVerdict: { passed: true, missing: [], evidence: ['curl → 200'], at: 'now' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tasks[0].status).toBe('passed');
    expect(r.value.tasks[0].attempts).toBe(2);
    expect(r.value.tasks[0].lastVerdict?.evidence).toEqual(['curl → 200']);
  });

  it('leaves title and verify untouched — there is no patch field for them', () => {
    const r = applySessionUpdate(ledger(), [{ id: 't-1', status: 'passed' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tasks[0].title).toBe(ledger().tasks[0].title);
    expect(r.value.tasks[0].verify).toEqual(ledger().tasks[0].verify);
    // Nothing was added or dropped either.
    expect(r.value.tasks.map((t) => t.id)).toEqual(['t-1', 't-2']);
  });

  it('refuses a patch for a task that does not exist', () => {
    const r = applySessionUpdate(ledger(), [{ id: 't-99', status: 'passed' }]);
    expect(r.ok).toBe(false);
  });

  it('refuses a negative or fractional attempt count', () => {
    expect(applySessionUpdate(ledger(), [{ id: 't-1', attempts: -1 }]).ok).toBe(false);
    expect(applySessionUpdate(ledger(), [{ id: 't-1', attempts: 1.5 }]).ok).toBe(false);
  });

  it('does not mutate the ledger it was given', () => {
    const before = ledger();
    applySessionUpdate(before, [{ id: 't-1', status: 'passed' }]);
    expect(before.tasks[0].status).toBe('todo');
  });
});

describe('illegalChanges — the tamper check', () => {
  /*
   * The threat is concrete: the execution session has `Write` and the ledger is
   * in its working directory. Deleting a task it could not finish, or softening
   * `verify` until its work passes, are both reward hacking and both invisible
   * to a loop that simply re-reads the file.
   */
  it('passes a legitimate status change', () => {
    const after = applySessionUpdate(ledger(), [{ id: 't-1', status: 'passed', attempts: 1 }]);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(illegalChanges(ledger(), after.value)).toEqual([]);
  });

  it('catches a deleted task', () => {
    const after: Ledger = { version: 1, tasks: [ledger().tasks[0]] };
    expect(illegalChanges(ledger(), after)).toEqual([
      expect.stringContaining('t-2'),
    ]);
    expect(illegalChanges(ledger(), after)[0]).toMatch(/removed/);
  });

  it('catches softened verification steps', () => {
    const after = ledger();
    after.tasks[0].verify = ['looks fine'];
    const problems = illegalChanges(ledger(), after);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/verification steps changed/);
  });

  it('catches a retitled task', () => {
    const after = ledger();
    after.tasks[1].title = 'Something easier';
    expect(illegalChanges(ledger(), after)[0]).toMatch(/retitled/);
  });

  it('catches a task smuggled in without a plan revision', () => {
    const after = ledger();
    after.tasks.push({ id: 't-3', title: 'Extra', verify: [], status: 'passed', attempts: 0, lastVerdict: null });
    expect(illegalChanges(ledger(), after)[0]).toMatch(/added/);
  });

  it('reports every problem, not just the first', () => {
    const after: Ledger = { version: 1, tasks: [{ ...ledger().tasks[0], title: 'x', verify: [] }] };
    expect(illegalChanges(ledger(), after).length).toBeGreaterThan(2);
  });
});

describe('ledgerStateHash — the no-progress fingerprint', () => {
  it('changes when a status changes', () => {
    const after = applySessionUpdate(ledger(), [{ id: 't-1', status: 'passed' }]);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(ledgerStateHash(after.value)).not.toBe(ledgerStateHash(ledger()));
  });

  it('does NOT change when only attempts move', () => {
    /*
     * The whole point. An agent failing the same task forty times increments
     * `attempts` forty times; if that counted as progress, the no-progress stop
     * would never fire and this is precisely the runaway it exists to catch —
     * 240 retries over three hours, in the case that motivated it.
     */
    const after = applySessionUpdate(ledger(), [
      { id: 't-1', attempts: 40, lastVerdict: { passed: false, missing: ['still broken'], evidence: [], at: 'now' } },
    ]);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(ledgerStateHash(after.value)).toBe(ledgerStateHash(ledger()));
  });

  it('is order-independent, so a reordered file is not mistaken for progress', () => {
    const reordered: Ledger = { version: 1, tasks: [...ledger().tasks].reverse() };
    expect(ledgerStateHash(reordered)).toBe(ledgerStateHash(ledger()));
  });
});

describe('scheduling', () => {
  it('resumes an interrupted task before starting a fresh one', () => {
    const l = ledger();
    l.tasks[1].status = 'doing';
    expect(nextTask(l)?.id).toBe('t-2');
  });

  it('otherwise takes the first todo, one at a time', () => {
    expect(nextTask(ledger())?.id).toBe('t-1');
  });

  it('returns null when everything has passed', () => {
    const l = ledger();
    l.tasks.forEach((t) => (t.status = 'passed'));
    expect(nextTask(l)).toBeNull();
    expect(isComplete(l)).toBe(true);
  });

  it('an empty ledger is not complete', () => {
    // Otherwise a run that failed to plan would report success immediately.
    expect(isComplete({ version: 1, tasks: [] })).toBe(false);
  });

  it('a blocked task does not count as complete', () => {
    const l = ledger();
    l.tasks[0].status = 'passed';
    l.tasks[1].status = 'blocked';
    expect(isComplete(l)).toBe(false);
    expect(nextTask(l)).toBeNull();
  });
});

describe('progress log', () => {
  it('creates a header once and appends thereafter', async () => {
    await appendProgress(dir, 'Session 1: built the ledger.');
    await appendProgress(dir, 'Session 2: wired the loop.');
    const text = await fsp.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    expect(text.match(/# Progress/g)).toHaveLength(1);
    expect(text).toContain('Session 1: built the ledger.');
    expect(text).toContain('Session 2: wired the loop.');
    // Append-only: the earlier entry survives the later one.
    expect(text.indexOf('Session 1')).toBeLessThan(text.indexOf('Session 2'));
  });
});

describe('atomic writes', () => {
  it('leaves no temp files behind', async () => {
    await writeLedger(dir, ledger());
    const entries = await fsp.readdir(dir);
    expect(entries.filter((e) => e.includes('.tmp-'))).toEqual([]);
    expect(entries).toContain(LEDGER_FILE);
  });

  it('a previous ledger survives a failed write', async () => {
    await writeLedger(dir, ledger());
    // A directory where the temp file wants to go makes the write fail.
    await expect(writeLedger(path.join(dir, LEDGER_FILE), ledger())).rejects.toBeTruthy();
    const back = await readLedger(dir);
    expect(back.ok).toBe(true);
  });
});

describe('ensureGitignored', () => {
  it('adds the entry once', async () => {
    await fsp.writeFile(path.join(dir, '.gitignore'), 'node_modules\n');
    expect(await ensureGitignored(dir)).toBe(true);
    const text = await fsp.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(text).toContain('.aime/');

    // Idempotent — running every session must not append forever.
    expect(await ensureGitignored(dir)).toBe(false);
    const again = await fsp.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(again.match(/\.aime\//g)).toHaveLength(1);
  });

  it('recognises the entry written without a trailing slash', async () => {
    await fsp.writeFile(path.join(dir, '.gitignore'), '.aime\n');
    expect(await ensureGitignored(dir)).toBe(false);
  });

  it('does nothing when the folder is not a git repo', async () => {
    expect(await ensureGitignored(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
  });

  it('does not corrupt a .gitignore with no trailing newline', async () => {
    await fsp.writeFile(path.join(dir, '.gitignore'), 'dist');
    await ensureGitignored(dir);
    const lines = (await fsp.readFile(path.join(dir, '.gitignore'), 'utf8')).split('\n');
    expect(lines).toContain('dist');
    expect(lines).toContain('.aime/');
  });
});

describe('harnessDir is per conversation', () => {
  it('gives two conversations on ONE folder separate state', () => {
    /*
     * Keying on the folder alone meant one goal per project forever — a finished
     * run occupied every new chat on that folder and there was no way to start
     * another. It was also a correctness problem: the registry refuses a second
     * run by CONVERSATION id, so two conversations on one folder would both
     * believe they owned the run and interleave ledger writes.
     */
    const a = harnessDir('/tmp/proj', 'conv-a');
    const b = harnessDir('/tmp/proj', 'conv-b');
    expect(a).not.toBe(b);
    expect(a).toContain('conv-a');
  });

  it('falls back to the folder path when there is no conversation', () => {
    expect(harnessDir('/tmp/proj')).toBe(path.join('/tmp/proj', '.aime', 'harness'));
  });

  it('cannot be made to climb out of the harness directory', () => {
    // A conversation id is one of our own uuids, but it lands in a path.
    const escaped = harnessDir('/tmp/proj', '../../../etc');
    expect(escaped.includes('..')).toBe(false);
    expect(escaped.startsWith(path.join('/tmp/proj', '.aime', 'harness'))).toBe(true);
  });
});

describe('a conversation can run more than one goal', () => {
  it('numbers runs, and never reuses a number', async () => {
    /*
     * One goal per chat was the wrong shape. Finishing something and wanting the
     * next thing done is how work goes, and forcing a new conversation for it
     * throws away the context of what just happened.
     */
    expect(await nextRunIndex(dir, 'conv-a')).toBe(1);
    await fsp.mkdir(harnessDir(dir, 'conv-a', 1), { recursive: true });
    expect(await currentRunIndex(dir, 'conv-a')).toBe(1);
    expect(await nextRunIndex(dir, 'conv-a')).toBe(2);

    await fsp.mkdir(harnessDir(dir, 'conv-a', 2), { recursive: true });
    expect(await listRuns(dir, 'conv-a')).toEqual([1, 2]);
    expect(await currentRunIndex(dir, 'conv-a')).toBe(2);
  });

  it('keeps each run’s state apart', async () => {
    // The second goal must not inherit the first one's ledger.
    await writeLedger(harnessDir(dir, 'conv-a', 1), ledger());
    const second = harnessDir(dir, 'conv-a', 2);
    await fsp.mkdir(second, { recursive: true });
    expect((await readLedger(second)).ok).toBe(false);
    expect((await readLedger(harnessDir(dir, 'conv-a', 1))).ok).toBe(true);
  });

  it('two conversations number independently', async () => {
    await fsp.mkdir(harnessDir(dir, 'conv-a', 1), { recursive: true });
    expect(await nextRunIndex(dir, 'conv-b')).toBe(1);
  });

  it('reports no runs for a conversation that has none', async () => {
    expect(await listRuns(dir, 'nobody')).toEqual([]);
    expect(await currentRunIndex(dir, 'nobody')).toBeNull();
  });
});
