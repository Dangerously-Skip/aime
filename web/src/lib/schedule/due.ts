/**
 * WHEN A SCHEDULED JOB IS DUE — one implementation, both tickers.
 *
 * THE PROBLEM THIS SOLVES. Cron jobs tick in the renderer and standing orders
 * tick in the Next server, and each had its own copy of the same rule: active,
 * not expired, under its execution cap, and matching its trigger. Not similar —
 * the same, line for line.
 *
 * `scheduler-pass.ts` said so itself: its due-checking "mirrors
 * evaluateStandingOrders exactly … but is implemented here rather than imported:
 * the engine module pulls in a 'use client' zustand store, and this code runs
 * from the instrumentation-started ticker where that import chain has no
 * business existing."
 *
 * That is a MODULE BOUNDARY problem wearing a domain problem's clothes. The rule
 * is pure; only its address was wrong. So it moves here, to a file that imports
 * nothing — the same split that already worked for `harness/ledger-core`, and
 * for the same reason.
 *
 * It also removes a defensive dynamic import: the server loaded `matchesCron`
 * lazily and skipped cron orders for a whole tick if the load failed, because
 * the alternative was dragging a client store into the server bundle.
 *
 * This is step 1 of DR-24. It is worth doing on its own even if the rest never
 * happens: two implementations of one rule is a divergence waiting to be found
 * by a user, and the comment above is an admission it was already known.
 */

import { matchesCron } from './cron';
import { parseIntervalMs } from './interval';

/*
 * The parsers moved to `cron.ts` and `interval.ts` — one each, shared by the
 * tickers, the Cockpit and the save-time validation, so a schedule that shows a
 * next run is one that fires. Re-exported because both tickers import them from
 * here. Both siblings import nothing, so this module still reaches no store.
 */
export { matchesCron, parseIntervalMs };

/** The shape both schedulers agree on. Deliberately minimal. */
export interface SchedulableJob {
  status: string;
  trigger: { type: 'cron' | 'interval' | 'event'; expression?: string };
  lastRun?: number;
  /**
   * When the job was created. An interval job that has never run counts its
   * first interval from here — see `isJobDue`.
   */
  createdAt?: number;
  runCount: number;
  maxExecutions?: number;
  expiresAt?: number;
}

/**
 * Is this job due at `nowMs`?
 *
 * PURE, and that is the point — no clock, no store, no dynamic import. Both
 * tickers pass their own `now`, which is also what makes it testable without
 * waiting a minute.
 */
export function isJobDue(job: SchedulableJob, nowMs: number): boolean {
  if (job.status !== 'active') return false;
  if (job.expiresAt && nowMs >= job.expiresAt) return false;
  if (job.maxExecutions && job.runCount >= job.maxExecutions) return false;

  const { trigger } = job;

  if (trigger.type === 'cron' && trigger.expression) {
    if (!matchesCron(trigger.expression, new Date(nowMs))) return false;
    /*
     * Same-minute double-fire guard. A minute tick can arrive twice inside one
     * minute — a resumed laptop, a slow tick, two listeners — and a cron
     * expression matches for the whole minute, so without this the job runs
     * twice and the second run costs money for nothing.
     */
    if (job.lastRun && Math.floor(job.lastRun / 60_000) === Math.floor(nowMs / 60_000)) return false;
    return true;
  }

  if (trigger.type === 'interval' && trigger.expression) {
    const intervalMs = parseIntervalMs(trigger.expression);
    if (!intervalMs) return false;
    /*
     * THE FIRST INTERVAL COUNTS FROM CREATION. "Remind me in 5 minutes" is
     * created as `5m` with `maxExecutions: 1`, and "never run ⇒ due now" fired
     * it on the next minute tick — a reminder that arrived four minutes early,
     * which is the one thing a reminder must not do. "Every 30 minutes" means
     * the first run is thirty minutes out, too.
     *
     * A job with neither `lastRun` nor `createdAt` is still due now: that is the
     * old contract, and why DR-24's migration stamps `lastRun` rather than
     * leaving it empty — otherwise every migrated job fires at once.
     */
    const since = job.lastRun || job.createdAt;
    return !since || nowMs - since >= intervalMs;
  }

  // Event triggers are fired by whatever raises the event, never by the clock.
  return false;
}
