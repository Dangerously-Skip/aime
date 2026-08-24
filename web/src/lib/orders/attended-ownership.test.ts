import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * EXACTLY ONE TICKER OWNS EACH JOB (DR-24 D-1, step 2).
 *
 * Cron jobs and standing orders are the same thing scheduled two ways, and
 * unifying them must not simply delete the renderer implementation — the
 * difference is real:
 *
 *   attended    the renderer owns it. It can drive a visible surface and use
 *               the browser webview, and cannot run with the window closed.
 *   unattended  the server owns it. It survives the window closing.
 *
 * The danger of one manifest and two tickers is a job that fires TWICE: once
 * in the server pass, once in the renderer. Real money, and on a browsing job,
 * real actions taken twice. So ownership is exclusive, and this is the test
 * that says so.
 */

let dir = '';

vi.mock('@/lib/app-paths', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDataDir: () => dir,
}));

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  instruction: 'do the thing',
  trigger: { type: 'interval', expression: '30m' },
  notifyVia: 'card',
  state: {},
  status: 'active',
  runCount: 0,
  errorCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

async function seed(orders: unknown[]) {
  await fs.writeFile(
    path.join(dir, 'order-schedule.json'),
    JSON.stringify({ orders }),
    'utf8',
  );
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attended-'));
  vi.resetModules();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe('the server pass', () => {
  it('runs an unattended job that is due', async () => {
    await seed([order({ id: 'unattended' })]);
    const { runDueOrders } = await import('./scheduler-pass');
    const execute = vi.fn().mockResolvedValue({ ok: true, summary: 'done' });
    const acted = await runDueOrders(Date.now(), execute);
    expect(acted).toEqual(['unattended']);
  });

  it('SKIPS an attended job, however due it is', async () => {
    /*
     * The load-bearing one. This job has no `lastRun`, so an interval trigger
     * makes it due immediately — the server would run it on the very next tick
     * if ownership were not checked, and the renderer would run it too.
     */
    await seed([order({ id: 'attended', attended: true })]);
    const { runDueOrders } = await import('./scheduler-pass');
    const execute = vi.fn().mockResolvedValue({ ok: true, summary: 'done' });
    const acted = await runDueOrders(Date.now(), execute);
    expect(acted).toEqual([]);
    expect(execute, 'the server ran a job the renderer owns').not.toHaveBeenCalled();
  });

  it('does not touch the attended job record either', async () => {
    // Not even `lastRun`: stamping it here would make the renderer think the
    // job had already run this minute and skip it, so the job runs NEVER
    // instead of twice. The quieter failure, and the worse one.
    await seed([order({ id: 'attended', attended: true })]);
    const { runDueOrders } = await import('./scheduler-pass');
    await runDueOrders(Date.now(), vi.fn());
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'order-schedule.json'), 'utf8'));
    expect(raw.orders[0].lastRun).toBeUndefined();
    expect(raw.orders[0].runCount).toBe(0);
  });

  it('picks the unattended ones out of a mixed manifest', async () => {
    await seed([
      order({ id: 'a', attended: true }),
      order({ id: 'b' }),
      order({ id: 'c', attended: true }),
      order({ id: 'd' }),
    ]);
    const { runDueOrders } = await import('./scheduler-pass');
    const acted = await runDueOrders(Date.now(), vi.fn().mockResolvedValue({ ok: true, summary: '' }));
    expect(acted.sort()).toEqual(['b', 'd']);
  });
});

describe('absent means unattended', () => {
  it('every order that exists today keeps running on the server', async () => {
    /*
     * The additive guarantee for step 1: no migration has happened yet, so an
     * order with no `attended` field must behave exactly as before. Defaulting
     * the other way would silently stop every existing standing order.
     */
    await seed([order({ id: 'legacy' })]);
    const { runDueOrders } = await import('./scheduler-pass');
    const acted = await runDueOrders(Date.now(), vi.fn().mockResolvedValue({ ok: true, summary: '' }));
    expect(acted).toEqual(['legacy']);
  });

  it('an explicit false is also the server', async () => {
    await seed([order({ id: 'explicit', attended: false })]);
    const { runDueOrders } = await import('./scheduler-pass');
    const acted = await runDueOrders(Date.now(), vi.fn().mockResolvedValue({ ok: true, summary: '' }));
    expect(acted).toEqual(['explicit']);
  });
});
