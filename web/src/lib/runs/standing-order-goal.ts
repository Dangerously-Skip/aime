/**
 * Adapts a StandingOrder into a Goal.
 *
 * Standing orders are already goals in everything but name: a durable
 * instruction, a schedule, a completion condition, and a run history. Treating
 * them as Goals makes the Cockpit's "Scheduled work" section real immediately,
 * and means Clawish inherits everything the user has already set up rather than
 * asking them to recreate it.
 *
 * Pure — no store access — so it can be tested and reused server-side.
 */
import type { ApprovalPolicy, Goal } from './types';
import { parseIntervalMs } from '@/lib/schedule/interval';

/**
 * The policy each kind of schedule RUNS under — read by the executor that
 * enforces it and by every screen that describes it, so the two cannot drift.
 * (They had: attended jobs were labelled 'consequential' and ran as chats.)
 */
export const STANDING_ORDER_POLICY: ApprovalPolicy = 'consequential';
export const ATTENDED_JOB_POLICY: ApprovalPolicy = 'never';

/** The slice of a StandingOrder this adapter needs. */
export interface StandingOrderLike {
  id: string;
  instruction: string;
  trigger: { type: 'cron' | 'interval' | 'event'; expression?: string; event?: string };
  condition?: string;
  completionCondition?: string;
  status: 'active' | 'paused' | 'completed' | 'expired';
  lastRun?: number;
  runCount: number;
  errorCount: number;
  totalCost?: number;
  createdAt: number;
}

/**
 * An interval expression in seconds, or null when it cannot be read.
 *
 * DELEGATES to the one parser the tickers use. This had its own, more permissive
 * grammar ("1.5h", "90 minutes", a bare "90") while the tickers rejected those —
 * so the Cockpit showed a next run for an order that never fired.
 */
export function parseIntervalSeconds(expression?: string): number | null {
  const ms = parseIntervalMs(expression);
  return ms === null ? null : Math.round(ms / 1_000);
}

/**
 * Convert a standing order to a Goal.
 *
 * Deliberately does NOT map `errorCount` onto `consecutiveFailures`. They are
 * different facts: an order with forty successes and one old failure would
 * otherwise render as "currently failing", which is exactly the false alarm the
 * Cockpit exists to avoid. Consecutive failures are earned from real Run
 * records; the historical totals ride along in `prior` as context.
 */
export function standingOrderToGoal(order: StandingOrderLike): Goal {
  const isCron = order.trigger.type === 'cron';
  const everySeconds =
    order.trigger.type === 'interval' ? parseIntervalSeconds(order.trigger.expression) : null;

  const schedule =
    isCron && order.trigger.expression
      ? { cron: order.trigger.expression }
      : everySeconds != null
        ? { everySeconds }
        : undefined;

  return {
    id: `so:${order.id}`,
    sourceId: order.id,
    objective: order.instruction,
    /**
     * Deliberately NOT mapped to successCriteria. A completion condition is a
     * STOP-condition ("when X happens, this order is done"), not a per-run
     * success criterion. Conflating them would make every watch-type order
     * read as a failing run every night until the day it completes. The
     * executor uses the verifier against the completion condition separately —
     * to decide completion, never to grade the run.
     */
    constraints: order.condition,
    // Standing orders run on the server with nobody watching, so they carry
    // 'consequential' — and the executor passes THIS value to the provider, so
    // the label and the enforcement cannot drift apart. Reads and in-app
    // actions run; anything with effects outside the app is REFUSED and
    // recorded on the run. Not paused: there is nothing to resume it.
    approvalPolicy: STANDING_ORDER_POLICY,
    schedule,
    // Only an active order is live; paused/completed/expired must not appear to
    // be scheduled.
    enabled: order.status === 'active',
    createdAt: order.createdAt,
    lastRunAt: order.lastRun,
    surfaceId: 'assistant',
    prior:
      order.runCount > 0 || order.errorCount > 0
        ? { runCount: order.runCount, errorCount: order.errorCount, totalUsd: order.totalCost }
        : undefined,
  };
}

/** The slice of an attended job (a manifest order run by the renderer) this adapter needs. */
export interface AttendedJobLike {
  id: string;
  prompt: string;
  surfaceId: string;
  status: string;
  trigger: { type: 'cron' | 'interval' | 'event'; expression?: string };
  lastRun?: number;
  createdAt?: number;
  runCount: number;
}

/**
 * An attended job as a Goal, so the Cockpit lists EVERY schedule.
 *
 * Jobs created from Customize or a project run in the renderer against a
 * surface, and the Cockpit only ever adapted standing orders — so the schedules
 * that most need watching (they stop when the window closes) were the ones it
 * could not show.
 */
export function attendedJobToGoal(job: AttendedJobLike): Goal {
  const everySeconds = job.trigger.type === 'interval' ? parseIntervalSeconds(job.trigger.expression) : null;
  return {
    id: `job:${job.id}`,
    sourceId: job.id,
    objective: job.prompt,
    /*
     * 'never', because that is what runs. An attended job fires as an ordinary
     * conversation turn in the renderer (`job-conversation.ts`), and a turn on
     * the chat route gets the interactive policy. This said 'consequential' —
     * a promise of refusals nothing enforced. The Security settings and the
     * user's connector blocks still apply, as they do to any chat.
     */
    approvalPolicy: ATTENDED_JOB_POLICY,
    schedule:
      job.trigger.type === 'cron' && job.trigger.expression
        ? { cron: job.trigger.expression }
        : everySeconds != null
          ? { everySeconds }
          : undefined,
    enabled: job.status === 'active',
    createdAt: job.createdAt ?? 0,
    lastRunAt: job.lastRun,
    surfaceId: job.surfaceId,
    attended: true,
  };
}

/** Adapt a list, skipping orders with no instruction to show. */
export function standingOrdersToGoals(orders: StandingOrderLike[]): Goal[] {
  return orders.filter((o) => o.instruction?.trim()).map(standingOrderToGoal);
}
