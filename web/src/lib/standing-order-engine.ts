/**
 * Standing Order Trigger Engine.
 * Evaluates which standing orders should fire based on their trigger type and current time.
 */

import { matchesCron } from '@/stores/cron-store';
import type { StandingOrder } from '@/stores/assistant-store';
import { isJobDue } from '@/lib/schedule/due';

/**
 * Parse an interval expression like "5m", "1h", "30s" into milliseconds.
 */
function parseInterval(expression: string): number | null {
  const match = expression.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': case 'sec': return value * 1000;
    case 'm': case 'min': return value * 60000;
    case 'h': case 'hr': return value * 3600000;
    case 'd': case 'day': return value * 86400000;
    default: return null;
  }
}

/**
 * Evaluate all standing orders and return those whose triggers match the current time.
 * Does NOT execute them — just determines which should fire.
 */
export function evaluateStandingOrders(
  orders: StandingOrder[],
  now: Date = new Date()
): StandingOrder[] {
  /*
   * ONE RULE, SHARED WITH THE SERVER TICKER (DR-24 step 1).
   *
   * This function's body was reimplemented line for line in
   * `orders/scheduler-pass.ts`, which said so in a comment and explained that it
   * had to, because this module pulls in a `'use client'` zustand store.
   *
   * That was a module-boundary problem, not a domain one: the rule is pure, and
   * only its address was wrong. It lives in `lib/schedule/due.ts` now, which
   * imports nothing, and both tickers call it. Two copies of one due-check is a
   * divergence waiting to be found by a user whose job fires twice or never.
   */
  const nowMs = now.getTime();
  return orders.filter((order) => isJobDue(order, nowMs));
}

/**
 * Compute a simple hash of a string for snapshot comparison.
 */
export function hashSnapshot(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}
