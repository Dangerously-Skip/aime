import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isJobDue, parseIntervalMs, matchesCron, type SchedulableJob } from './due';
import { evaluateStandingOrders } from '@/lib/standing-order-engine';
import { isOrderDue } from '@/lib/orders/scheduler-pass';

/**
 * ONE DUE-CHECK, SHARED BY BOTH TICKERS (DR-24 step 1).
 *
 * Cron jobs tick in the renderer, standing orders tick in the Next server, and
 * each had its own copy of the same rule. `scheduler-pass.ts` said so and
 * explained why: "the engine module pulls in a 'use client' zustand store, and
 * this code runs from the instrumentation-started ticker where that import
 * chain has no business existing."
 *
 * A module-boundary problem wearing a domain problem's clothes. The rule is
 * pure; only its address was wrong.
 */

const job = (over: Partial<SchedulableJob> = {}): SchedulableJob => ({
  status: 'active',
  trigger: { type: 'interval', expression: '30m' },
  runCount: 0,
  ...over,
});

const AT = new Date('2026-07-27T12:34:30.000Z').getTime();

describe('the rule itself', () => {
  it('gates on status, expiry and execution cap', () => {
    expect(isJobDue(job({ status: 'paused' }), AT)).toBe(false);
    expect(isJobDue(job({ expiresAt: 1 }), AT)).toBe(false);
    expect(isJobDue(job({ maxExecutions: 2, runCount: 2 }), AT)).toBe(false);
  });

  it('an interval job that has never run is due NOW', () => {
    /*
     * Deliberate, and the reason DR-24's migration must stamp `lastRun`: a
     * migration that leaves it empty makes every job due on the next tick, and
     * the user's morning is twenty simultaneous agent runs.
     */
    expect(isJobDue(job(), AT)).toBe(true);
  });

  it('guards a same-minute double fire', () => {
    // A tick can arrive twice inside one minute — a resumed laptop, a slow tick,
    // two listeners — and a cron expression matches for the whole minute.
    const cronJob = job({ trigger: { type: 'cron', expression: '* * * * *' } });
    expect(isJobDue(cronJob, AT)).toBe(true);
    expect(isJobDue({ ...cronJob, lastRun: AT - 5_000 }, AT)).toBe(false);
    expect(isJobDue({ ...cronJob, lastRun: AT - 60_000 }, AT)).toBe(true);
  });

  it('never fires an event trigger from the clock', () => {
    expect(isJobDue(job({ trigger: { type: 'event' } }), AT)).toBe(false);
  });
});

describe('the interval spellings both sides already accepted', () => {
  /*
   * I WROTE A NARROWER PARSER HERE AND THE SUITE CAUGHT IT. Both originals took
   * `s|sec|m|min|h|hr|d|day` with an optional trailing `s`; a fresh `(s|m|h|d)`
   * would have parsed `5min` and `2hr` as null, so every order configured that
   * way would silently never fire again.
   */
  it.each([
    ['30s', 30_000], ['30 sec', 30_000], ['30secs', 30_000],
    ['5m', 300_000], ['5min', 300_000], ['5 mins', 300_000],
    ['2h', 7_200_000], ['2hr', 7_200_000], ['2 hours'.replace('ours', 'rs'), 7_200_000],
    ['1d', 86_400_000], ['1day', 86_400_000],
  ])('%s → %ims', (expr, ms) => {
    expect(parseIntervalMs(expr)).toBe(ms);
  });

  it('returns null for nonsense rather than a wrong number', () => {
    for (const bad of ['', 'soon', '5', 'm5', '-5m']) expect(parseIntervalMs(bad)).toBeNull();
  });
});

describe('both tickers now agree, by construction', () => {
  /*
   * The load-bearing test. Two implementations of one rule is a divergence
   * waiting to be found by a user whose job fires twice or never — so this
   * drives the RENDERER path and the SERVER path over the same inputs and
   * requires the same answer.
   */
  const cases: Array<[string, Partial<SchedulableJob>]> = [
    ['active interval, never run', {}],
    ['interval run a moment ago', { lastRun: AT - 1_000 }],
    ['interval long overdue', { lastRun: AT - 60 * 60_000 }],
    ['paused', { status: 'paused' }],
    ['expired', { expiresAt: 1 }],
    ['at its cap', { maxExecutions: 1, runCount: 1 }],
    ['cron matching now', { trigger: { type: 'cron', expression: '* * * * *' } }],
    ['cron not matching now', { trigger: { type: 'cron', expression: '0 3 * * *' } }],
    ['cron already fired this minute', {
      trigger: { type: 'cron', expression: '* * * * *' }, lastRun: AT - 5_000,
    }],
    ['minute-spelled interval', { trigger: { type: 'interval', expression: '5min' } }],
    ['event trigger', { trigger: { type: 'event' } }],
  ];

  it.each(cases)('%s — renderer and server agree', (_name, over) => {
    const j = job(over);
    const server = isOrderDue(j as never, AT);
    const renderer = evaluateStandingOrders([j as never], new Date(AT)).length === 1;
    expect(renderer, 'renderer and server disagree about whether this job is due').toBe(server);
  });
});

describe('the module boundary that caused the duplication', () => {
  it('imports nothing, so the server can use it directly', () => {
    /*
     * The whole reason the server had its own copy. If this file ever imports a
     * store — or anything that reaches one — the dynamic-import workaround comes
     * back, and with it a second implementation.
     */
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/schedule/due.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports, `due.ts must import nothing, found: ${imports.join(' | ')}`).toEqual([]);
  });

  it('the server no longer lazily loads a cron matcher', () => {
    const pass = fs.readFileSync(path.join(process.cwd(), 'src/lib/orders/scheduler-pass.ts'), 'utf8');
    // It used to `await import('@/stores/cron-store')` and skip cron orders for a
    // whole tick if that failed.
    expect(pass).not.toMatch(/await import\(['"]@\/stores\/cron-store/);
  });
});
