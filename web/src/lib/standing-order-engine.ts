/**
 * Standing Order Trigger Engine.
 * Evaluates which standing orders should fire based on their trigger type and current time.
 */

import { matchesCron } from '@/stores/cron-store';
import type { StandingOrder } from '@/stores/assistant-store';

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
  const nowMs = now.getTime();
  const matched: StandingOrder[] = [];

  for (const order of orders) {
    // Skip non-active orders
    if (order.status !== 'active') continue;

    // Check expiry
    if (order.expiresAt && nowMs >= order.expiresAt) continue;

    // Check max executions
    if (order.maxExecutions && order.runCount >= order.maxExecutions) continue;

    // Check trigger
    const { trigger } = order;

    if (trigger.type === 'cron' && trigger.expression) {
      if (matchesCron(trigger.expression, now)) {
        // Prevent double-firing within the same minute
        if (order.lastRun) {
          const lastRunMinute = Math.floor(order.lastRun / 60000);
          const nowMinute = Math.floor(nowMs / 60000);
          if (lastRunMinute === nowMinute) continue;
        }
        matched.push(order);
      }
    } else if (trigger.type === 'interval' && trigger.expression) {
      const intervalMs = parseInterval(trigger.expression);
      if (intervalMs && (!order.lastRun || nowMs - order.lastRun >= intervalMs)) {
        matched.push(order);
      }
    } else if (trigger.type === 'event') {
      // Event triggers are handled externally (webhooks, connector polling)
      // They set a flag that the engine checks — placeholder for now
      continue;
    }
  }

  return matched;
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
