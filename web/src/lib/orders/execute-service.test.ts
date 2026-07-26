import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeOrderServerSide, PAUSE_AFTER_CONSECUTIVE_ERRORS } from './execute-service';
import type { ManifestOrder } from './manifest';
import { readRuns, __resetRunLogPath } from '@/lib/runs/run-log';

/**
 * The server-side order executor — the C5b port of the renderer's executeOrder.
 * These tests carry forward the guarantees the old renderer tests pinned:
 * every execution records a costed Run, completion is judged by the verifier
 * (the keyword hack stays dead), and the verifier fails closed.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: queryMock, abort: vi.fn() }),
  getAvailableProviders: () => ['claude'],
}));

/** Route provider calls: order executions vs verifier calls, by chatId. */
function script(opts: { orderText: string; verdict?: { passed: boolean; note?: string } | 'crash' }) {
  queryMock.mockImplementation(async function* (params: { chatId: string }) {
    if (params.chatId.startsWith('verify-')) {
      if (opts.verdict === 'crash') throw new Error('verifier exploded');
      yield { type: 'text', provider: 'claude', content: JSON.stringify(opts.verdict ?? { passed: false }) };
      return;
    }
    yield { type: 'text', provider: 'claude', content: opts.orderText };
    yield { type: 'done', provider: 'claude', usage: { inputTokens: 50, outputTokens: 90, cost: 0.006 } };
  });
}

const order = (over: Partial<ManifestOrder> = {}): ManifestOrder => ({
  id: 'o1',
  instruction: 'Watch AAPL and report when it crosses $200',
  trigger: { type: 'interval', expression: '30m' },
  state: {},
  status: 'active',
  notifyVia: 'assistant',
  runCount: 0,
  errorCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

let dir: string;
beforeEach(() => {
  queryMock.mockReset();
  dir = mkdtempSync(join(tmpdir(), 'aime-orders-'));
  process.env.AIME_USER_DATA_DIR = dir;
  __resetRunLogPath();
});
afterEach(() => {
  delete process.env.AIME_USER_DATA_DIR;
  __resetRunLogPath();
  rmSync(dir, { recursive: true, force: true });
});

describe('executeOrderServerSide — run recording', () => {
  it('records a succeeded run with cost in the durable log', async () => {
    script({ orderText: 'AAPL is at $187 — nothing to report.' });
    const result = await executeOrderServerSide(order());

    expect(result.run).toMatchObject({ status: 'succeeded', goalId: 'so:o1', trigger: 'cron' });
    expect(result.run.cost).toEqual({ inputTokens: 50, outputTokens: 90, totalUsd: 0.006 });
    expect((await readRuns())[0]).toMatchObject({ goalId: 'so:o1', status: 'succeeded' });
  });

  it('patches counters and emits a result entry', async () => {
    script({ orderText: 'Report body here.' });
    const result = await executeOrderServerSide(order({ runCount: 4 }));

    expect(result.patch).toMatchObject({ runCount: 5, errorCount: 0 });
    expect(result.patch.totalCost).toBeCloseTo(0.006);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ kind: 'result', orderId: 'o1', summary: 'Report body here.' });
  });

  it('a provider failure records a failed run and increments errorCount', async () => {
    queryMock.mockImplementation(async function* () {
      throw new Error('upstream 502');
    });
    const result = await executeOrderServerSide(order({ errorCount: 0 }));

    expect(result.run.status).toBe('failed');
    expect(result.patch.errorCount).toBe(1);
    expect(result.patch.status).toBeUndefined(); // not paused yet
    expect(result.entries[0]).toMatchObject({ kind: 'error' });
  });

  it('auto-pauses after the consecutive-error threshold, with a paused entry', async () => {
    queryMock.mockImplementation(async function* () {
      throw new Error('still broken');
    });
    const result = await executeOrderServerSide(order({ errorCount: PAUSE_AFTER_CONSECUTIVE_ERRORS - 1 }));

    expect(result.patch.status).toBe('paused');
    expect(result.entries.map((e) => e.kind)).toEqual(['error', 'paused']);
  });

  it('an empty reply is a failure, not a silent success', async () => {
    script({ orderText: '   ' });
    const result = await executeOrderServerSide(order());
    expect(result.run.status).toBe('failed');
    expect(result.run.error).toMatch(/Empty response/);
  });
});

describe('executeOrderServerSide — output processing', () => {
  it('extracts STATE into the merged state and strips it from the card', async () => {
    script({ orderText: 'AAPL at $190.\nSTATE: {"lastPrice": 190}' });
    const result = await executeOrderServerSide(order({ state: { watching: 'AAPL' } }));

    expect(result.patch.state).toEqual({ watching: 'AAPL', lastPrice: 190 });
    expect(result.entries[0].summary).not.toContain('STATE:');
  });

  it('skips the card when output is unchanged on a conditional order', async () => {
    script({ orderText: 'Same output as before.' });
    const first = await executeOrderServerSide(order({ condition: 'only if changed' }));
    const second = await executeOrderServerSide(
      order({ condition: 'only if changed', lastSnapshotHash: first.patch.lastSnapshotHash }),
    );

    expect(second.entries).toHaveLength(0); // no card
    expect(second.patch.runCount).toBe(1); // but the run still counts
  });

  it('carries an A2UI document through to the entry', async () => {
    const doc = JSON.stringify({ version: '1', components: [] });
    script({ orderText: 'Here is your dashboard:\n```a2ui\n' + doc + '\n```' });
    const result = await executeOrderServerSide(order());
    expect(result.entries[0].docJson).toBe(doc);
    expect(result.entries[0].summary).not.toContain('```');
  });
});

describe('executeOrderServerSide — completion (the keyword hack stays dead)', () => {
  it('does NOT complete just because the output says "done"', async () => {
    script({ orderText: 'Nothing done yet, AAPL is at $185.', verdict: { passed: false } });
    const result = await executeOrderServerSide(order({ completionCondition: 'AAPL crossed $200' }));
    expect(result.patch.status).toBeUndefined();
  });

  it('completes when the verifier confirms the condition', async () => {
    script({ orderText: 'AAPL just hit $201.30.', verdict: { passed: true, note: 'price crossed' } });
    const result = await executeOrderServerSide(order({ completionCondition: 'AAPL crossed $200' }));

    expect(result.patch.status).toBe('completed');
    expect(result.entries.map((e) => e.kind)).toEqual(['result', 'completed']);
  });

  // False positive silently kills the order; false negative keeps watching.
  it('fails closed — a crashed verifier never completes the order', async () => {
    script({ orderText: 'AAPL at $205 — condition met!', verdict: 'crash' });
    const result = await executeOrderServerSide(order({ completionCondition: 'AAPL crossed $200' }));
    expect(result.patch.status).toBeUndefined();
  });

  it('completes on maxExecutions regardless of the verifier', async () => {
    script({ orderText: 'run output' });
    const result = await executeOrderServerSide(order({ maxExecutions: 3, runCount: 2 }));
    expect(result.patch.status).toBe('completed');
  });
});
