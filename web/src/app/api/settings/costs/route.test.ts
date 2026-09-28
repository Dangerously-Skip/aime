import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GET } from './route';
import { appendRun, __resetRunLogPath } from '@/lib/runs/run-log';
import { summarizeSpend, UNATTRIBUTED_SURFACE } from '@/lib/runs/spend';
import type { Run } from '@/lib/runs/types';

/**
 * Usage & ROI's "API spend by surface" read a map of cost trackers that nothing
 * ever created, so it said $0.00 to everyone. It now folds the run log — the
 * provider-reported cost of each recorded run — written and read through the
 * REAL log file here.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-costs-'));
  vi.stubEnv('AIME_USER_DATA_DIR', dir);
  __resetRunLogPath();
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetRunLogPath();
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (over: Partial<Run>): Run => ({
  id: Math.random().toString(36).slice(2),
  goalId: null,
  trigger: 'chat',
  status: 'succeeded',
  startedAt: 1,
  deliverables: [],
  ...over,
});

describe('GET /api/settings/costs', () => {
  it('reports zero with no history, not an error', async () => {
    const body = await (await GET()).json();
    expect(body.total).toEqual({ inputTokens: 0, outputTokens: 0, totalUsd: 0, runs: 0 });
    expect(body.surfaces).toEqual({});
  });

  it('sums the recorded runs per surface', async () => {
    await appendRun(run({ surfaceId: 'chat', cost: { inputTokens: 1000, outputTokens: 200, totalUsd: 0.01 } }));
    await appendRun(run({ surfaceId: 'chat', cost: { inputTokens: 500, outputTokens: 100, totalUsd: 0.005 } }));
    await appendRun(run({ surfaceId: 'cowork', cost: { inputTokens: 40_000, outputTokens: 3_000, totalUsd: 0.4 } }));
    await appendRun(run({ surfaceId: 'code' })); // no reported cost — not counted

    const body = await (await GET()).json();
    expect(body.surfaces.chat).toEqual({ inputTokens: 1500, outputTokens: 300, totalUsd: 0.015, runs: 2 });
    expect(body.surfaces.cowork.totalUsd).toBeCloseTo(0.4);
    expect(body.surfaces.code).toBeUndefined();
    expect(body.total.runs).toBe(3);
    expect(body.total.totalUsd).toBeCloseTo(0.415);
    expect(body.runsConsidered).toBe(4);
  });
});

describe('summarizeSpend', () => {
  it('files unattended runs with no surface under one bucket', () => {
    const s = summarizeSpend([run({ cost: { inputTokens: 1, outputTokens: 1, totalUsd: 0.1 } })]);
    expect(Object.keys(s.surfaces)).toEqual([UNATTRIBUTED_SURFACE]);
  });

  it('ignores garbage numbers rather than poisoning the total', () => {
    const s = summarizeSpend([
      run({ surfaceId: 'chat', cost: { inputTokens: Number.NaN, outputTokens: -5, totalUsd: Infinity } }),
      run({ surfaceId: 'chat', cost: { inputTokens: 10, outputTokens: 5, totalUsd: 0.02 } }),
    ]);
    expect(s.total).toEqual({ inputTokens: 10, outputTokens: 5, totalUsd: 0.02, runs: 2 });
  });
});
