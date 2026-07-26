/**
 * The server-side standing-order scheduler pass — C5b's other half.
 *
 * Due-checking mirrors evaluateStandingOrders exactly (active only, expiry,
 * max-executions, cron with same-minute double-fire guard, interval with
 * fire-immediately-when-never-run) but is implemented here rather than
 * imported: the engine module pulls in a 'use client' zustand store, and this
 * code runs from the instrumentation-started ticker where that import chain
 * has no business existing. matchesCron alone is loaded dynamically and
 * defensively — if it cannot load, cron orders are skipped for that tick
 * rather than crashing the scheduler.
 */
import { readOrderManifest, patchManifestOrder, appendInbox, type ManifestOrder } from './manifest';
import type { OrderExecutionResult } from './execute-service';

/** Interval parsing identical to the engine's ("5m", "1h", "30s", "2 days"). */
function parseIntervalMs(expression: string): number | null {
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

type CronMatcher = (expression: string, now: Date) => boolean;

async function loadCronMatcher(): Promise<CronMatcher | null> {
  try {
    const { matchesCron } = await import('@/stores/cron-store');
    return matchesCron;
  } catch {
    return null;
  }
}

/** Is this order due at `now`? Pure given the injected cron matcher. */
export function isOrderDue(order: ManifestOrder, nowMs: number, cron: CronMatcher | null): boolean {
  if (order.status !== 'active') return false;
  if (order.expiresAt && nowMs >= order.expiresAt) return false;
  if (order.maxExecutions && order.runCount >= order.maxExecutions) return false;

  const { trigger } = order;
  if (trigger.type === 'cron' && trigger.expression) {
    if (!cron || !cron(trigger.expression, new Date(nowMs))) return false;
    // Same-minute double-fire guard, matching the engine.
    if (order.lastRun && Math.floor(order.lastRun / 60_000) === Math.floor(nowMs / 60_000)) return false;
    return true;
  }
  if (trigger.type === 'interval' && trigger.expression) {
    const intervalMs = parseIntervalMs(trigger.expression);
    return Boolean(intervalMs && (!order.lastRun || nowMs - order.lastRun >= intervalMs));
  }
  // Event triggers are fired externally, never by the clock.
  return false;
}

type ExecuteFn = (order: ManifestOrder) => Promise<OrderExecutionResult>;

/** In-flight guard: a slow order must not overlap itself on the next tick. */
const inFlight = new Set<string>();

/**
 * One pass: execute every due order, patch the manifest, queue inbox entries.
 * `execute` is injected so tests never touch a model.
 */
export async function runDueOrders(now: number, execute: ExecuteFn): Promise<string[]> {
  const orders = await readOrderManifest();
  if (!orders.length) return [];
  const cron = await loadCronMatcher();
  const acted: string[] = [];

  for (const order of orders) {
    if (inFlight.has(order.id)) continue;
    if (!isOrderDue(order, now, cron)) continue;

    inFlight.add(order.id);
    acted.push(order.id);
    try {
      const result = await execute(order);
      await patchManifestOrder(order.id, result.patch);
      await appendInbox(result.entries);
    } catch (err) {
      // The execute service handles its own failures; reaching here means
      // something around it broke. Stamp lastRun so the order doesn't hot-loop.
      console.error('[scheduler] order execution failed:', order.id, err);
      await patchManifestOrder(order.id, { lastRun: now, errorCount: order.errorCount + 1 }).catch(() => false);
    } finally {
      inFlight.delete(order.id);
    }
  }
  return acted;
}
