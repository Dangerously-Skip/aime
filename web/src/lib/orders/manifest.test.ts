import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readOrderManifest,
  writeOrderManifest,
  mergeOrders,
  patchManifestOrder,
  readInbox,
  appendInbox,
  ackInbox,
  __resetOrderPaths,
  type ManifestOrder,
  type InboxEntry,
} from './manifest';
import { runDueOrders, isOrderDue } from './scheduler-pass';
import type { OrderExecutionResult } from './execute-service';
import type { Run } from '@/lib/runs/types';

const order = (over: Partial<ManifestOrder> = {}): ManifestOrder => ({
  id: 'o1',
  instruction: 'Watch AAPL',
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

const entry = (id: string): InboxEntry => ({
  id,
  orderId: 'o1',
  ts: 1,
  kind: 'result',
  title: 't',
  notifyVia: 'assistant',
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aime-omanifest-'));
  process.env.AIME_USER_DATA_DIR = dir;
  __resetOrderPaths();
});
afterEach(() => {
  delete process.env.AIME_USER_DATA_DIR;
  __resetOrderPaths();
  rmSync(dir, { recursive: true, force: true });
});

describe('order manifest', () => {
  it('round-trips, patches, and tolerates a missing file', async () => {
    expect(await readOrderManifest()).toEqual([]);
    await writeOrderManifest([order()]);
    await patchManifestOrder('o1', { runCount: 3 });
    expect((await readOrderManifest())[0].runCount).toBe(3);
  });
});

describe('mergeOrders — field ownership', () => {
  it('lets the renderer own CRUD when the server has not run more recently', () => {
    const merged = mergeOrders(
      [order({ instruction: 'edited', lastRun: 9_000 })],
      [order({ instruction: 'old', lastRun: 1_000 })],
    );
    expect(merged[0].instruction).toBe('edited');
  });

  // A stale client must not erase work done while it was closed.
  it('keeps server execution results when the server ran more recently', () => {
    const merged = mergeOrders(
      [order({ runCount: 2, lastRun: 1_000, state: {} })],
      [order({ runCount: 6, lastRun: 9_000, state: { seen: true }, errorCount: 1, totalCost: 0.5 })],
    );
    expect(merged[0]).toMatchObject({ runCount: 6, lastRun: 9_000, errorCount: 1, totalCost: 0.5 });
    expect(merged[0].state).toEqual({ seen: true });
  });

  // Flipping a completed order back to active would re-execute it.
  it('a terminal server status sticks against a stale active mirror', () => {
    const merged = mergeOrders(
      [order({ status: 'active', lastRun: 1_000 })],
      [order({ status: 'completed', lastRun: 9_000 })],
    );
    expect(merged[0].status).toBe('completed');
  });

  it('renderer deletion wins — orders absent from the mirror are dropped', () => {
    const merged = mergeOrders([], [order()]);
    expect(merged).toEqual([]);
  });
});

describe('inbox', () => {
  it('appends, reads, and acks exactly the given ids', async () => {
    await appendInbox([entry('a'), entry('b'), entry('c')]);
    await ackInbox(['a', 'c']);
    expect((await readInbox()).map((e) => e.id)).toEqual(['b']);
  });

  it('empty appends and acks are no-ops', async () => {
    expect(await appendInbox([])).toBe(true);
    expect(await ackInbox([])).toBe(true);
    expect(await readInbox()).toEqual([]);
  });
});

describe('isOrderDue', () => {
  /*
   * NO INJECTED MATCHER ANY MORE (DR-24 step 1).
   *
   * These passed a fake `cron` that returned true for one hardcoded expression,
   * which meant they never exercised the real matcher — the boundary the rule
   * exists to enforce. `matchesCron` is pure and now importable from
   * `lib/schedule/due`, so the tests use REAL cron expressions and the third
   * argument is gone.
   */
  it('interval orders fire immediately when never run, then wait', () => {
    expect(isOrderDue(order(), Date.now())).toBe(true);
    expect(isOrderDue(order({ lastRun: Date.now() - 60_000 }), Date.now())).toBe(false);
    expect(isOrderDue(order({ lastRun: Date.now() - 31 * 60_000 }), Date.now())).toBe(true);
  });

  it('gates on status, expiry and max executions', () => {
    expect(isOrderDue(order({ status: 'paused' }), Date.now())).toBe(false);
    expect(isOrderDue(order({ expiresAt: 1 }), Date.now())).toBe(false);
    expect(isOrderDue(order({ maxExecutions: 2, runCount: 2 }), Date.now())).toBe(false);
  });

  it('cron orders match the real expression and guard same-minute double-fire', () => {
    const o = order({ trigger: { type: 'cron', expression: '* * * * *' } });
    /*
     * A FIXED instant, 30s into a minute. With Date.now() this failed roughly 8%
     * of runs: when the real clock landed in the first 5 seconds of a minute,
     * `now - 5_000` fell into the PREVIOUS minute, so the same-minute guard
     * correctly did not apply and the assertion below was simply wrong. The code
     * was right; the test's assumption was not.
     */
    const now = new Date('2026-07-27T12:34:30.000Z').getTime();
    expect(isOrderDue(o, now)).toBe(true);
    expect(isOrderDue({ ...o, lastRun: now - 5_000 }, now)).toBe(false); // same minute
    // …and the guard really is minute-scoped: a run a minute ago is due again.
    expect(isOrderDue({ ...o, lastRun: now - 60_000 }, now)).toBe(true);
  });

  it('a cron expression that does NOT match is not due', () => {
    // The half a fake matcher could never check: the real parser saying no.
    const at = new Date('2026-07-27T12:34:30.000Z').getTime();
    expect(isOrderDue(order({ trigger: { type: 'cron', expression: '0 3 * * *' } }), at)).toBe(false);
  });

  it('a malformed cron expression is not due, rather than throwing', () => {
    const at = new Date('2026-07-27T12:34:30.000Z').getTime();
    expect(isOrderDue(order({ trigger: { type: 'cron', expression: 'nonsense' } }), at)).toBe(false);
  });

  it('event triggers are never fired by the clock', () => {
    expect(isOrderDue(order({ trigger: { type: 'event', event: 'push' } }), Date.now())).toBe(false);
  });
});

describe('runDueOrders', () => {
  const okExecution = (): OrderExecutionResult => ({
    patch: { lastRun: Date.now(), runCount: 1, errorCount: 0 },
    entries: [entry('in_1')],
    run: { id: 'r1', goalId: 'so:o1', trigger: 'cron', status: 'succeeded', startedAt: 1, deliverables: [] } as Run,
  });

  it('executes due orders, patches the manifest, and queues the inbox', async () => {
    await writeOrderManifest([order()]);
    const execute = vi.fn(async () => okExecution());

    const acted = await runDueOrders(Date.now(), execute);

    expect(acted).toEqual(['o1']);
    expect((await readOrderManifest())[0].runCount).toBe(1);
    expect((await readInbox()).map((e) => e.id)).toEqual(['in_1']);
  });

  it('skips not-due orders without executing', async () => {
    await writeOrderManifest([order({ lastRun: Date.now() - 60_000 })]);
    const execute = vi.fn(async () => okExecution());
    expect(await runDueOrders(Date.now(), execute)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('a throwing execution stamps lastRun so the order cannot hot-loop', async () => {
    await writeOrderManifest([order()]);
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });
    const now = Date.now();
    await runDueOrders(now, execute);
    const [saved] = await readOrderManifest();
    expect(saved.lastRun).toBe(now);
    expect(saved.errorCount).toBe(1);
  });
});
