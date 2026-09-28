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
import type { Goal } from './types';
import { parseIntervalMs } from '@/lib/schedule/interval';

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
    // Standing orders predate approval policy. 'consequential' is the safe
    // default: unattended work still pauses before side effects.
    approvalPolicy: 'consequential',
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

/** Adapt a list, skipping orders with no instruction to show. */
export function standingOrdersToGoals(orders: StandingOrderLike[]): Goal[] {
  return orders.filter((o) => o.instruction?.trim()).map(standingOrderToGoal);
}
