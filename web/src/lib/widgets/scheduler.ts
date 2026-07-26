/**
 * The server-side widget scheduler — P6/C5, the "works while you sleep" piece.
 *
 * Until now, scheduled refreshes ran from a renderer hook on the minute tick,
 * so closing the window stopped everything. This ticker lives in the Next
 * server process, which Electron main forks at app start and which OUTLIVES the
 * window (on macOS the app keeps running in the dock). It reads the schedule
 * manifest — not the renderer — so a due widget refreshes with no window at
 * all, its run lands in the durable log, and its render is written back to the
 * manifest for the renderer to merge on next launch.
 *
 * Ownership rule: with the scheduler on, the SERVER owns interval execution.
 * The renderer no longer fires scheduled refreshes (its hook is sync-only),
 * so a widget can never double-fire from both sides of the IPC boundary.
 */
import { isIntervalDue } from '@/lib/runs/runs';
import { decideRetry, MAX_ATTEMPTS } from '@/lib/runs/verification';
import { resolveRoute, createDefaultRegistry } from '@/lib/models/registry';
import type { Tier } from '@/lib/models/types';
import { widgetToGoal, type Widget } from './widget';
import { readManifest, patchManifestWidget } from './schedule-manifest';
import type { RefreshOpts, RefreshResult } from './refresh-service';

export const TICK_MS = 60_000;

type RefreshFn = (widget: Widget, trigger: 'cron', opts?: RefreshOpts) => Promise<RefreshResult>;

/** Driver model for a tier, from the default registry (chat capability). */
function modelForTier(tier: Tier): string | undefined {
  return resolveRoute(createDefaultRegistry(), 'chat', tier, () => true)?.model.driverModel;
}

/**
 * Refresh with the C4 retry policy auto-invoked (this was the gap: decideRetry
 * existed but nothing called it). Up to MAX_ATTEMPTS per trigger:
 *
 * - A reply that couldn't become a renderable node is a CAPABILITY failure —
 *   the model answered, the outcome wasn't achieved — so it is presented to
 *   decideRetry as a verification-unmet run, which escalates the tier
 *   (cheap → good → …). Re-asking the same cheap model just fails the same way.
 * - Any other failure (provider error, timeout) reads as transient and retries
 *   on the same tier.
 *
 * Every attempt records its own Run (the refresh service does that), so the
 * Cockpit shows the whole ladder, not just the final outcome.
 */
export async function refreshWithRetry(
  widget: Widget,
  refresh: RefreshFn,
): Promise<RefreshResult> {
  let tier: Tier = 'cheap';
  let result = await refresh(widget, 'cron', { model: modelForTier(tier) });

  for (let attempt = 1; attempt < MAX_ATTEMPTS && result.status !== 200; attempt++) {
    const capabilityFailure = Boolean(result.error?.includes('renderable'));
    const decision = decideRetry({
      goal: { ...widgetToGoal(widget), tier },
      // A non-renderable reply is "ran, but unmet", not an error — that is
      // what makes decideRetry escalate instead of blindly repeating.
      run: capabilityFailure
        ? { ...result.run, status: 'succeeded', verification: { passed: false, note: result.error } }
        : result.run,
      attempt,
    });

    if (decision.action === 'escalate' && decision.tier) {
      tier = decision.tier;
    } else if (decision.action !== 'retry') {
      break; // give_up / ask / none — stop the ladder
    }
    result = await refresh(widget, 'cron', { model: modelForTier(tier) });
  }
  return result;
}

/** In-flight guard: a slow refresh must not overlap itself on the next tick. */
const inFlight = new Set<string>();

/**
 * One scheduler pass: refresh every enabled widget whose interval has elapsed.
 * `refresh` is injected so tests never touch a model. Returns the ids acted on.
 */
export async function runDueWidgets(
  now: number,
  refresh: RefreshFn,
): Promise<string[]> {
  const widgets = await readManifest();
  const acted: string[] = [];

  for (const widget of widgets) {
    if (inFlight.has(widget.id)) continue;
    if (!isIntervalDue(widgetToGoal(widget), now)) continue;

    inFlight.add(widget.id);
    acted.push(widget.id);
    try {
      const result = await refreshWithRetry(widget, refresh);
      // Stamp refreshedAt on BOTH outcomes so a broken widget retries next
      // interval, not every tick. The failed run is already in the durable
      // log, so the Cockpit shows the failure either way.
      await patchManifestWidget(widget.id, {
        refreshedAt: Date.now(),
        ...(result.node ? { render: result.node } : {}),
      });
    } catch (err) {
      console.error('[scheduler] widget refresh failed:', widget.id, err);
      await patchManifestWidget(widget.id, { refreshedAt: Date.now() }).catch(() => false);
    } finally {
      inFlight.delete(widget.id);
    }
  }
  return acted;
}

/**
 * Start the ticker. Guarded on globalThis so Next dev HMR — which re-evaluates
 * modules — cannot stack a second interval beside the first.
 */
const STARTED = Symbol.for('aime.widget-scheduler.started');

export function startWidgetScheduler(): void {
  const g = globalThis as { [STARTED]?: boolean };
  if (g[STARTED]) return;
  g[STARTED] = true;

  console.log('[scheduler] widget scheduler started (tick', TICK_MS / 1000, 's)');
  const timer = setInterval(() => {
    void (async () => {
      const { refreshWidget } = await import('./refresh-service');
      await runDueWidgets(Date.now(), refreshWidget).catch((err) =>
        console.error('[scheduler] tick failed:', err),
      );
      // Standing orders (C5b) share the tick: due orders execute here in the
      // server process, results queue in the inbox for the renderer to replay.
      const { runDueOrders } = await import('../orders/scheduler-pass');
      const { executeOrderServerSide } = await import('../orders/execute-service');
      await runDueOrders(Date.now(), executeOrderServerSide).catch((err) =>
        console.error('[scheduler] order tick failed:', err),
      );
    })();
  }, TICK_MS);
  // Never hold the process open just to tick — Electron owns the lifecycle.
  timer.unref?.();
}
