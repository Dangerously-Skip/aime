import { parseIntervalMs } from './interval';
import { nextCronRun } from './cron';
import { describeTrigger, validateTrigger, type Trigger } from './schedule';

/**
 * What needs the user's attention about their schedules, right now.
 *
 * WHY THIS EXISTS. A failed automation run added one line to an activity log
 * and nothing else; an order that stopped firing looked exactly like one that
 * was working. The Cockpit could show some of it, but only if you opened the
 * Cockpit — and the point of scheduled work is that you are not watching it.
 * So the Assistant's Activity tab leads with this list, and it is empty (and
 * hidden) when all is well.
 *
 * Pure: the caller passes the stores' contents and a clock.
 */

export type HealthKind = 'failed' | 'paused' | 'invalid' | 'overdue' | 'failed-runs' | 'refused';

export interface HealthItem {
  key: string;
  kind: HealthKind;
  /** The schedule to open, when there is one. */
  orderId?: string;
  title: string;
  detail: string;
}

export interface HealthOrder {
  id: string;
  instruction: string;
  trigger: Trigger;
  status: string;
  lastRun?: number;
  createdAt?: number;
  errorCount?: number;
  runCount?: number;
  maxExecutions?: number;
  expiresAt?: number;
  /** Runs in the renderer, so only with the window open. */
  attended?: boolean;
}

export interface HealthActivity {
  orderId?: string;
  type: string;
  label: string;
  timestamp: number;
}

export interface HealthRun {
  status: string;
  startedAt: number;
  goalId?: string | null;
  /** Steps the run's gate refused — see `Run.refusals`. */
  refusals?: Array<{ tool: string }>;
}

/** How late a run may be before it counts as missed: ticks are a minute apart. */
export const OVERDUE_GRACE_MS = 5 * 60_000;

/** When this job SHOULD have run next after its last run — or null if not applicable. */
export function expectedRunAt(order: HealthOrder): number | null {
  if (order.status !== 'active' || validateTrigger(order.trigger)) return null;
  if (order.maxExecutions && (order.runCount ?? 0) >= order.maxExecutions) return null;
  const since = order.lastRun ?? order.createdAt;
  if (since === undefined) return null;
  let at: number | null = null;
  if (order.trigger.type === 'interval') at = since + parseIntervalMs(order.trigger.expression)!;
  else if (order.trigger.type === 'cron') at = nextCronRun(order.trigger.expression!, new Date(since))?.getTime() ?? null;
  if (at !== null && order.expiresAt && at >= order.expiresAt) return null;
  return at;
}

/** Attended jobs are edited in Customize/projects, not the order editor. */
const openable = (order: HealthOrder) => (order.attended ? undefined : order.id);

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

export function scheduleHealth(input: {
  orders: HealthOrder[];
  activity?: HealthActivity[];
  runs?: HealthRun[];
  now: number;
  appName?: string;
}): HealthItem[] {
  const { orders, activity = [], runs = [], now } = input;
  const items: HealthItem[] = [];

  // The newest run per goal decides "its last run had steps refused".
  const latestRun = new Map<string, HealthRun>();
  for (const r of runs) {
    if (!r.goalId) continue;
    const seen = latestRun.get(r.goalId);
    if (!seen || r.startedAt > seen.startedAt) latestRun.set(r.goalId, r);
  }

  // The newest activity entry per order decides "currently failing".
  const latest = new Map<string, HealthActivity>();
  for (const a of activity) {
    if (!a.orderId) continue;
    const seen = latest.get(a.orderId);
    if (!seen || a.timestamp > seen.timestamp) latest.set(a.orderId, a);
  }

  for (const order of orders) {
    const title = short(order.instruction);
    const invalid = validateTrigger(order.trigger);
    if (invalid && order.status !== 'completed' && order.status !== 'expired') {
      items.push({ key: `invalid:${order.id}`, kind: 'invalid', orderId: openable(order), title, detail: `Schedule can't run: ${invalid}` });
      continue;
    }

    const last = latest.get(order.id);
    if (order.status === 'paused' && (order.errorCount ?? 0) > 0) {
      items.push({
        key: `paused:${order.id}`,
        kind: 'paused',
        orderId: openable(order),
        title,
        detail: `Paused after ${order.errorCount} error${order.errorCount === 1 ? '' : 's'}${last?.type === 'order-error' ? ` — ${last.label}` : ''}`,
      });
      continue;
    }
    if (order.status === 'active' && last?.type === 'order-error') {
      items.push({ key: `failed:${order.id}`, kind: 'failed', orderId: openable(order), title, detail: last.label });
      continue;
    }

    const expected = expectedRunAt(order);
    if (expected !== null && now - expected > OVERDUE_GRACE_MS) {
      const mins = Math.round((now - expected) / 60_000);
      const late = mins < 120 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} hours` : `${Math.round(mins / 1440)} days`;
      items.push({
        key: `overdue:${order.id}`,
        kind: 'overdue',
        orderId: openable(order),
        title,
        detail: `${describeTrigger(order.trigger)} — missed its run ${late} ago${
          order.attended ? ` (runs only while ${input.appName ?? 'the app'} is open)` : ''
        }`,
      });
    }

    /*
     * REFUSED STEPS. A background order runs with nobody to ask, so a step with
     * effects outside the app is refused rather than paused — and a run that
     * "succeeded" without doing half its job is exactly the quiet failure this
     * list exists to surface. Only the LATEST run counts: the next clean run
     * clears it, as the next success clears a failure.
     */
    const refusals = order.attended ? undefined : latestRun.get(`so:${order.id}`)?.refusals;
    if (refusals?.length) {
      const tools = [...new Set(refusals.map((r) => r.tool))];
      const named = tools.slice(0, 3).join(', ') + (tools.length > 3 ? ', …' : '');
      items.push({
        key: `refused:${order.id}`,
        kind: 'refused',
        orderId: openable(order),
        title,
        detail: `Last run had ${refusals.length} step${refusals.length === 1 ? '' : 's'} refused (${named}) — see its runs in the Cockpit`,
      });
    }
  }

  const dayAgo = now - 86_400_000;
  const failedRuns = runs.filter((r) => r.startedAt >= dayAgo && (r.status === 'failed' || r.status === 'timeout')).length;
  if (failedRuns > 0) {
    items.push({
      key: 'failed-runs',
      kind: 'failed-runs',
      title: `${failedRuns} run${failedRuns === 1 ? '' : 's'} failed in the last 24 hours`,
      detail: 'See Recent activity below for the reasons.',
    });
  }

  return items;
}
