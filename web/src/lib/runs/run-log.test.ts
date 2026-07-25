import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendRun, readRuns, compactRunLog, getRunLogPath, __resetRunLogPath } from './run-log';
import type { Run } from './types';

/**
 * Exercised against a REAL temp filesystem, not a mocked `fs`. The whole point
 * of this module is durability across restarts; a mocked test would prove only
 * that we call appendFile, which is the part that was never in doubt.
 */

let dir: string;

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  goalId: null,
  trigger: 'chat',
  status: 'succeeded',
  startedAt: 1_000,
  endedAt: 2_000,
  durationMs: 1_000,
  deliverables: [],
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aime-runs-'));
  process.env.AIME_USER_DATA_DIR = dir;
  __resetRunLogPath();
});

afterEach(() => {
  delete process.env.AIME_USER_DATA_DIR;
  __resetRunLogPath();
  rmSync(dir, { recursive: true, force: true });
});

describe('run log — durability', () => {
  it('creates the directory and appends one line per run', async () => {
    await appendRun(run({ id: 'a' }));
    await appendRun(run({ id: 'b' }));

    const file = await getRunLogPath();
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('a');
  });

  it('returns an empty list before anything has been written', async () => {
    expect(await readRuns()).toEqual([]);
  });

  it('reads back newest-first and survives a simulated restart', async () => {
    await appendRun(run({ id: 'old', startedAt: 1 }));
    await appendRun(run({ id: 'new', startedAt: 2 }));

    // Simulate a fresh process: drop the memoized path, read again.
    __resetRunLogPath();
    const runs = await readRuns();
    expect(runs.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('limit keeps the NEWEST runs, not the oldest', async () => {
    for (let i = 0; i < 10; i++) await appendRun(run({ id: `r${i}`, startedAt: i }));
    const runs = await readRuns({ limit: 3 });
    expect(runs.map((r) => r.id)).toEqual(['r9', 'r8', 'r7']);
  });

  it('filters by goalId', async () => {
    await appendRun(run({ id: 'a', goalId: 'g1' }));
    await appendRun(run({ id: 'b', goalId: 'g2' }));
    await appendRun(run({ id: 'c', goalId: 'g1' }));
    expect((await readRuns({ goalId: 'g1' })).map((r) => r.id)).toEqual(['c', 'a']);
  });

  it('preserves cost, so per-run spend survives a restart', async () => {
    await appendRun(run({ id: 'a', cost: { inputTokens: 10, outputTokens: 20, totalUsd: 0.05 }, toolCalls: 3 }));
    const [back] = await readRuns();
    expect(back.cost).toEqual({ inputTokens: 10, outputTokens: 20, totalUsd: 0.05 });
    expect(back.toolCalls).toBe(3);
  });
});

describe('run log — corruption tolerance', () => {
  // A crash mid-append leaves a partial trailing line. One bad line must not
  // blank the whole dashboard.
  it('skips a half-written trailing line and still returns the good runs', async () => {
    await appendRun(run({ id: 'good1' }));
    await appendRun(run({ id: 'good2' }));
    const file = await getRunLogPath();
    writeFileSync(file, readFileSync(file, 'utf-8') + '{"id":"trunc","stat', 'utf-8');

    const runs = await readRuns();
    expect(runs.map((r) => r.id)).toEqual(['good2', 'good1']);
  });

  it('skips garbage lines anywhere in the file', async () => {
    const file = await getRunLogPath();
    writeFileSync(file, `not json\n${JSON.stringify(run({ id: 'ok' }))}\n\n{]\n`, 'utf-8');
    expect((await readRuns()).map((r) => r.id)).toEqual(['ok']);
  });
});

describe('run log — compaction', () => {
  it('trims to the most recent N and leaves the file readable', async () => {
    for (let i = 0; i < 20; i++) await appendRun(run({ id: `r${i}`, startedAt: i }));
    const kept = await compactRunLog(5);
    expect(kept).toBe(5);

    const runs = await readRuns();
    expect(runs.map((r) => r.id)).toEqual(['r19', 'r18', 'r17', 'r16', 'r15']);
  });

  it('is a no-op below the threshold and on a missing file', async () => {
    await appendRun(run({ id: 'a' }));
    expect(await compactRunLog(50)).toBe(1);
    expect((await readRuns()).map((r) => r.id)).toEqual(['a']);

    rmSync(await getRunLogPath());
    expect(await compactRunLog(50)).toBe(0);
  });

  // Appending must never pay the compaction cost.
  it('appending after compaction continues cleanly', async () => {
    for (let i = 0; i < 10; i++) await appendRun(run({ id: `r${i}` }));
    await compactRunLog(3);
    await appendRun(run({ id: 'after' }));
    expect((await readRuns()).map((r) => r.id)[0]).toBe('after');
    expect(await readRuns()).toHaveLength(4);
  });
});
