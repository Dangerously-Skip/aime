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
import { isJobDue } from '@/lib/schedule/due';
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



/**
 * Is this order due? Delegates to the shared rule (DR-24 step 1).
 *
 * This function used to reimplement `evaluateStandingOrders` line for line, with
 * a comment explaining that it had to because the engine pulls in a `'use
 * client'` store. The rule now lives in `lib/schedule/due.ts`, which imports
 * nothing, so both tickers share one implementation and the dynamic
 * `matchesCron` load — which skipped cron orders for a whole tick when it
 * failed — is gone.
 *
 * Kept as a named wrapper rather than inlined: the manifest's `ManifestOrder` is
 * the caller's vocabulary, and this is where the two meet.
 */
export function isOrderDue(order: ManifestOrder, nowMs: number): boolean {
  return isJobDue(order, nowMs);
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
  const acted: string[] = [];

  for (const order of orders) {
    if (inFlight.has(order.id)) continue;
    if (!isOrderDue(order, now)) continue;

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
