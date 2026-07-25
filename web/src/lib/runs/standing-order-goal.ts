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
 * Parse an interval expression into seconds. Standing orders express intervals
 * as free text ("30m", "2 hours", "90"), so be permissive and return null when
 * it can't be read rather than guessing a schedule that would fire wrongly.
 */
export function parseIntervalSeconds(expression?: string): number | null {
  if (!expression) return null;
  const text = expression.trim().toLowerCase();

  const match = text.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2];
  if (!unit || unit.startsWith('s')) return Math.round(value);
  if (unit.startsWith('m') && !unit.startsWith('mo')) return Math.round(value * 60);
  if (unit.startsWith('h')) return Math.round(value * 3_600);
  if (unit.startsWith('d')) return Math.round(value * 86_400);
  return null;
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
    // A completion condition IS a success criterion — this is what lets a
    // standing order be verified rather than merely "not errored".
    successCriteria: order.completionCondition,
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
