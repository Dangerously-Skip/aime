import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { readRuns, __resetRunLogPath } from '@/lib/runs/run-log';
import type { Goal, Run } from '@/lib/runs/types';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: queryMock, abort: vi.fn() }),
  getAvailableProviders: () => ['claude'],
}));

function reply(text: string) {
  queryMock.mockImplementation(async function* () {
    yield { type: 'text', provider: 'claude', content: text };
  });
}

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  objective: 'Post overnight build failures to Slack',
  successCriteria: 'a message was posted to #builds',
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

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/runs/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

let dir: string;
beforeEach(() => {
  queryMock.mockReset();
  dir = mkdtempSync(join(tmpdir(), 'aime-verify-'));
  process.env.AIME_USER_DATA_DIR = dir;
  __resetRunLogPath();
});
afterEach(() => {
  delete process.env.AIME_USER_DATA_DIR;
  __resetRunLogPath();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/runs/verify — validation', () => {
  it('requires a goal and a run', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ goal: goal() })).status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/runs/verify — no criteria', () => {
  // "We never checked" must be distinguishable from "verified".
  it('returns a null verification rather than inventing a pass', async () => {
    const data = await (await post({ goal: goal({ successCriteria: undefined }), run: run() })).json();
    expect(data.verification).toBeNull();
    expect(data.decision.action).toBe('none');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/runs/verify — the verdict', () => {
  it('records a pass and recommends no action', async () => {
    reply('{"passed": true, "note": "message found in #builds"}');
    const data = await (await post({ goal: goal(), run: run(), outputSummary: 'Posted 3 failures.' })).json();

    expect(data.verification).toMatchObject({ passed: true, note: 'message found in #builds' });
    expect(data.decision.action).toBe('none');
    expect(data.run.verification.passed).toBe(true);
  });

  // The state no reference tool surfaces: it ran fine and did not do the job.
  it('marks a clean run as UNMET and escalates the tier', async () => {
    reply('{"passed": false, "note": "no message was posted"}');
    const data = await (await post({ goal: goal({ tier: 'cheap' }), run: run() })).json();

    expect(data.run.status).toBe('succeeded'); // it did not error…
    expect(data.verification.passed).toBe(false); // …and it did not achieve the goal
    expect(data.decision.action).toBe('escalate');
    expect(data.decision.tier).toBe('good');
  });

  it('passes the objective, criteria and output to the judge', async () => {
    reply('{"passed": true}');
    await post({
      goal: goal(),
      run: run({ deliverables: [{ kind: 'message', title: 'Slack post' }] }),
      outputSummary: 'Posted the summary.',
    });
    const prompt = queryMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Post overnight build failures to Slack');
    expect(prompt).toContain('a message was posted to #builds');
    expect(prompt).toContain('Posted the summary.');
    expect(prompt).toContain('Slack post');
  });

  it('uses a cheap model and no tool loop', async () => {
    reply('{"passed": true}');
    await post({ goal: goal(), run: run() });
    expect(queryMock.mock.calls[0][0].model).toBe('haiku');
    expect(queryMock.mock.calls[0][0].maxTurns).toBe(1);
  });
});

describe('POST /api/runs/verify — fails closed', () => {
  // A broken or confused verifier must never silently bless a run.
  it('treats an unreadable verdict as a failure', async () => {
    reply('I think it probably worked!');
    const data = await (await post({ goal: goal(), run: run() })).json();
    expect(data.verification.passed).toBe(false);
    expect(data.verification.note).toBeTruthy();
  });

  it('treats a verifier crash as a failure, not a pass', async () => {
    queryMock.mockImplementation(async function* () {
      throw new Error('provider exploded');
    });
    const data = await (await post({ goal: goal(), run: run() })).json();
    expect(data.verification.passed).toBe(false);
    expect(data.verification.note).toMatch(/could not be completed/i);
    // and it still recommends acting rather than moving on
    expect(data.decision.action).not.toBe('none');
  });
});

describe('POST /api/runs/verify — durability', () => {
  it('appends the verified record so the verdict survives a restart', async () => {
    reply('{"passed": false, "note": "nothing posted"}');
    await post({ goal: goal(), run: run() });

    const logged = await readRuns();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ id: 'r1', status: 'succeeded' });
    expect(logged[0].verification).toMatchObject({ passed: false });
  });

  // The log is append-only and read newest-first, so the verified record
  // supersedes an earlier bare one with the same id.
  it('the verified record reads back ahead of the unverified one', async () => {
    const { appendRun } = await import('@/lib/runs/run-log');
    await appendRun(run()); // the bare record written when the run finished
    reply('{"passed": true}');
    await post({ goal: goal(), run: run() });

    const logged = await readRuns();
    expect(logged[0].verification).toMatchObject({ passed: true });
  });

  /**
   * The unwritable path is a regular FILE used as the parent directory, so
   * `mkdir` fails with ENOTDIR on every platform. It used to be
   * `/proc/definitely-not-writable`, which is an assumption about the host: it
   * failed fast on macOS because `/proc` does not exist, and behaved differently
   * on the Linux CI box.
   *
   * The console assertion is the point. Without it, a path that turned out to be
   * writable would make this test pass while proving nothing — the response is
   * 200 either way. It is what says the failure path actually ran.
   */
  it('a failed log write does not fail the response', async () => {
    const notADir = join(dir, 'not-a-directory');
    writeFileSync(notADir, 'occupied');
    process.env.AIME_USER_DATA_DIR = notADir;
    __resetRunLogPath();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    reply('{"passed": true}');
    const res = await post({ goal: goal(), run: run() });

    expect(res.status).toBe(200);
    expect((await res.json()).verification.passed).toBe(true);
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
      /failed to append run record/,
    );
    errors.mockRestore();
  });
});
