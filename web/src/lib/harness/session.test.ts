import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseSessionStatus,
  buildSessionPrompt,
  progressTail,
  createSessionRunner,
  COMPLETE_MARKER,
  INCOMPLETE_MARKER,
} from './session';
import { PROGRESS_FILE, type Goal, type Task } from './ledger';

const goal: Goal = {
  version: 1,
  objective: 'Make every embed in the deck play',
  acceptanceCriteria: ['no Error 153', 'layout does not overflow'],
  budgetUsd: 5,
  deadlineIso: null,
  sessionCap: 10,
  createdAt: '2026-08-16T00:00:00.000Z',
};

const task: Task = {
  id: 't-7',
  title: 'Serve the deck over http',
  verify: ['fetch the preview URL', 'expect 200'],
  status: 'todo',
  attempts: 1,
  lastVerdict: null,
};

describe('parseSessionStatus — absence is not success', () => {
  it('reads a completion marker', () => {
    expect(parseSessionStatus(`did the thing\n${COMPLETE_MARKER}`)).toBe(true);
  });

  it('reads an incompletion marker', () => {
    expect(parseSessionStatus(`got stuck\n${INCOMPLETE_MARKER}`)).toBe(false);
  });

  it('treats NO marker as incomplete', () => {
    /*
     * The expensive mistake is reading "no answer" as "yes". A session that hit
     * the turn ceiling, crashed, or simply forgot has not finished — the same
     * rule pending-questions applies to silence.
     */
    expect(parseSessionStatus('I have completed the task and it all works!')).toBe(false);
    expect(parseSessionStatus('')).toBe(false);
  });

  it('is not fooled by prose that sounds like success', () => {
    expect(parseSessionStatus('Everything is done. All tests pass. Fully complete.')).toBe(false);
  });

  it('lets a later change of mind win', () => {
    // A session may claim completion, test it, and retract.
    expect(parseSessionStatus(`${COMPLETE_MARKER}\nactually the test failed\n${INCOMPLETE_MARKER}`)).toBe(false);
    expect(parseSessionStatus(`${INCOMPLETE_MARKER}\nfixed it\n${COMPLETE_MARKER}`)).toBe(true);
  });

  it('ignores a marker quoted far earlier in a long transcript', () => {
    // The instructions themselves contain both markers; echoing them at the
    // start of a long session must not count as claiming completion.
    const long = `I will finish by saying ${COMPLETE_MARKER} when done.\n` + 'x'.repeat(5000);
    expect(parseSessionStatus(long)).toBe(false);
  });
});

describe('buildSessionPrompt', () => {
  const prompt = () =>
    buildSessionPrompt({ goal, task, sessionIndex: 3, missing: [], progress: '' });

  it('names exactly one task and its verification steps', () => {
    const p = prompt();
    expect(p).toContain(task.title);
    for (const v of task.verify) expect(p).toContain(v);
    expect(p).toMatch(/THIS TASK ONLY/i);
  });

  it('carries the goal and its acceptance criteria', () => {
    const p = prompt();
    expect(p).toContain(goal.objective);
    for (const c of goal.acceptanceCriteria) expect(p).toContain(c);
  });

  it('repeats the previous rejection VERBATIM', () => {
    /*
     * Paraphrasing verifier feedback is how a loop repeats the same failure in
     * different words.
     */
    const missing = ['the iframe still returns Error 153', 'no test covers the redirect'];
    const p = buildSessionPrompt({ goal, task, sessionIndex: 2, missing, progress: '' });
    for (const m of missing) expect(p).toContain(m);
    expect(p).toMatch(/Do not start over/i);
  });

  it('instructs the session to test end to end', () => {
    // The single biggest observed failure in a long-running harness was an agent
    // that made changes and never checked them, and it did not test unless told.
    expect(prompt()).toMatch(/TEST YOUR WORK END TO END/i);
  });

  it('forbids editing the plan', () => {
    expect(prompt()).toMatch(/not edit the goal or the task list/i);
  });

  it('states both markers and that silence means incomplete', () => {
    const p = prompt();
    expect(p).toContain(COMPLETE_MARKER);
    expect(p).toContain(INCOMPLETE_MARKER);
    expect(p).toMatch(/Saying neither counts as/i);
  });

  it('omits the progress section when there is none, rather than an empty header', () => {
    expect(prompt()).not.toContain('# What previous sessions did');
  });
});

describe('progressTail', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-tail-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns nothing when there is no log', async () => {
    expect(await progressTail(dir)).toBe('');
  });

  it('returns the whole log when it is short', async () => {
    await fsp.writeFile(path.join(dir, PROGRESS_FILE), 'session one\n');
    expect(await progressTail(dir)).toContain('session one');
  });

  it('keeps the END of a long log, not the beginning', async () => {
    // Recent sessions orient the next one; the first session of a long run does
    // not.
    const body = 'old\n'.repeat(5000) + 'MOST RECENT\n';
    await fsp.writeFile(path.join(dir, PROGRESS_FILE), body);
    const tail = await progressTail(dir, 200);
    expect(tail).toContain('MOST RECENT');
    expect(tail.length).toBeLessThan(400);
  });
});

describe('createSessionRunner', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-run-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A function, not a const: a const is evaluated when the describe body runs,
  // which is BEFORE beforeEach, so it would capture an empty dir.
  const input = () => ({ goal, task, dir, sessionIndex: 1, missing: [] as string[] });

  async function* chunks(...cs: Record<string, unknown>[]) {
    for (const c of cs) yield c as { type: string };
  }

  it('accumulates text and reads the marker', async () => {
    const run = createSessionRunner({
      query: () => chunks({ type: 'text', content: 'working…' }, { type: 'text', content: `\n${COMPLETE_MARKER}` }),
      chatId: 'c1', cwd: dir, maxTurns: 30,
    });
    const out = await run(input());
    expect(out.claimsComplete).toBe(true);
    expect(out.summary).toContain('working');
  });

  it('takes the reported cost when the backend gives one', async () => {
    const run = createSessionRunner({
      query: () => chunks({ type: 'text', content: 'x' }, { type: 'done', totalCostUsd: 0.42 }),
      chatId: 'c1', cwd: dir, maxTurns: 30,
    });
    expect((await run(input())).costUsd).toBeCloseTo(0.42);
  });

  it('ESTIMATES when the backend reports no price', async () => {
    /*
     * `total_cost_usd` is an Anthropic-API field, so it is undefined on Bedrock,
     * Vertex and OpenRouter. Without the fallback, spend reads zero forever and
     * the budget stop condition is decorative on exactly the accounts where a
     * mis-set ceiling costs real money.
     */
    const run = createSessionRunner({
      query: () => chunks({ type: 'done', inputTokens: 1000, cacheReadInputTokens: 500, outputTokens: 200 }),
      chatId: 'c1', cwd: dir, maxTurns: 30,
      estimateCostUsd: (i, o) => i * 0.000001 + o * 0.000005,
    });
    const out = await run(input());
    expect(out.costUsd).toBeCloseTo(1500 * 0.000001 + 200 * 0.000005);
    expect(out.costUsd).toBeGreaterThan(0);
  });

  it('an error means not complete, even with a completion marker', async () => {
    const run = createSessionRunner({
      query: () => chunks({ type: 'text', content: COMPLETE_MARKER }, { type: 'error', content: 'the build failed' }),
      chatId: 'c1', cwd: dir, maxTurns: 30,
    });
    const out = await run(input());
    expect(out.error).toBe('the build failed');
    expect(out.claimsComplete).toBe(false);
  });

  it('a thrown provider is reported, not swallowed', async () => {
    const run = createSessionRunner({
      query: async function* () { throw new Error('subprocess died'); },
      chatId: 'c1', cwd: dir, maxTurns: 30,
    });
    const out = await run(input());
    expect(out.error).toMatch(/subprocess died/);
    expect(out.claimsComplete).toBe(false);
  });

  it('says so when the session produced nothing', async () => {
    const run = createSessionRunner({
      query: () => chunks(), chatId: 'c1', cwd: dir, maxTurns: 30,
    });
    expect((await run(input())).summary).toMatch(/no output/i);
  });

  it('passes the built prompt to the provider', async () => {
    let seen = '';
    const run = createSessionRunner({
      query: (args) => { seen = args.prompt; return chunks(); },
      chatId: 'c1', cwd: dir, maxTurns: 30,
    });
    await run({ ...input(), missing: ['still returns 153'] });
    expect(seen).toContain(task.title);
    expect(seen).toContain('still returns 153');
  });
});
