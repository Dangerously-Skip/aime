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

/**
 * Simple cron expression matcher.
 * Supports: minute hour dom month dow (standard 5-field cron)
 * Returns true if the given date matches the expression.
 */
export function matchesCron(expression: string, date: Date = new Date()): boolean {
  try {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [min, hour, dom, month, dow] = parts;

    const matches = (field: string, value: number): boolean => {
      if (field === '*') return true;
      // Comma-separated list
      if (field.includes(',')) {
        return field.split(',').some((f) => matches(f.trim(), value));
      }
      // Step values: */5, 0-59/5
      if (field.includes('/')) {
        const [range, step] = field.split('/');
        const stepNum = parseInt(step, 10);
        if (isNaN(stepNum)) return false;
        const [start, end] = range === '*'
          ? [0, 59]
          : range.split('-').map(Number);
        if (value < start || value > end) return false;
        return (value - start) % stepNum === 0;
      }
      // Range: 0-5
      if (field.includes('-')) {
        const [start, end] = field.split('-').map(Number);
        return value >= start && value <= end;
      }
      // Exact value
      return parseInt(field, 10) === value;
    };

    return (
      matches(min, date.getMinutes()) &&
      matches(hour, date.getHours()) &&
      matches(dom, date.getDate()) &&
      matches(month, date.getMonth() + 1) &&
      matches(dow, date.getDay())
    );
  } catch {
    return false;
  }
}

/**
 * `15m`, `5 min`, `2hr`, `1 day`, `30s` → milliseconds. Null when unreadable.
 *
 * THE FULL SPELLING SET, moved rather than rewritten. Both original parsers
 * accepted `s|sec|m|min|h|hr|d|day` with an optional trailing `s`; writing a
 * narrower one here from scratch silently broke every order configured as
 * `5min` or `2hr` — they would have parsed as null and never fired again.
 *
 * The suite caught it, which is the argument for extracting into a file that
 * both sides' tests already cover rather than reimplementing at the new address.
 */
export function parseIntervalMs(expression: string): number | null {
  const match = expression.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 's': case 'sec': return value * 1_000;
    case 'm': case 'min': return value * 60_000;
    case 'h': case 'hr': return value * 3_600_000;
    case 'd': case 'day': return value * 86_400_000;
    default: return null;
  }
}

/** The shape both schedulers agree on. Deliberately minimal. */
export interface SchedulableJob {
  status: string;
  trigger: { type: 'cron' | 'interval' | 'event'; expression?: string };
  lastRun?: number;
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
    // Never run ⇒ due now. That is deliberate for an interval job, and it is
    // also why DR-24's migration must stamp `lastRun` rather than leave it
    // empty: otherwise every migrated job fires at once.
    return Boolean(intervalMs && (!job.lastRun || nowMs - job.lastRun >= intervalMs));
  }

  // Event triggers are fired by whatever raises the event, never by the clock.
  return false;
}
