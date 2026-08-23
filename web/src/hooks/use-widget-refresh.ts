'use client';

import { useEffect, useRef } from 'react';
import { useWidgetStore } from '@/stores/widget-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useElectron } from '@/hooks/use-electron';
import { judgeChange } from '@/lib/widgets/unchanged';
import { changeHeadline } from '@/lib/widgets/describe-change';
import { decideAlert, type PendingAlert } from '@/lib/widgets/alerting';
import { APP_NAME } from '@/config/branding';
import type { Widget } from '@/lib/widgets/widget';

/**
 * Widget schedule SYNC (P6/C5). This hook used to fire scheduled refreshes from
 * the renderer's minute tick — meaning a closed window stopped every schedule.
 * Scheduled execution now lives in the server process (lib/widgets/scheduler,
 * started from instrumentation.ts), which outlives the window.
 *
 * The renderer's remaining jobs, both directions of a sync:
 *  - PUSH: mirror the widget list to the server manifest whenever it changes,
 *    so the scheduler always executes current state.
 *  - PULL: on launch and on each minute tick, merge back renders the scheduler
 *    produced — including everything that happened while the window was closed.
 *
 * Ownership rule: the server owns interval execution; the renderer never fires
 * a scheduled refresh. One owner means a widget can't double-fire across the
 * IPC boundary. Manual refreshes (the tile button) still run client-initiated.
 */
export function useWidgetRefresh() {
  const quietHours = useSettingsStore((s) => s.quietHours) ?? null;
  const { showNotification } = useElectron();
  /*
   * Held in a ref so the pull effect does not re-register when the notifier
   * identity changes. The listener discipline this hook already documents.
   */
  const notifyRef = useRef(showNotification);
  // In an effect, not during render: React forbids touching a ref while
  // rendering. Lint only flagged the identical line in `use-scheduled-prompt`,
  // so this one was a latent copy of the same mistake.
  useEffect(() => {
    notifyRef.current = showNotification;
  });

  const pushInFlight = useRef(false);
  const lastPushed = useRef<string>('');

  // PULL, then subscribe for PUSH. Registered once for the hook's lifetime —
  // the same listener discipline as useCron/useStandingOrders.
  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch('/api/schedule/widgets');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { widgets?: Widget[] };
        if (!Array.isArray(data.widgets)) return;

        const server = new Map(data.widgets.map((w) => [w.id, w]));
        const local = useWidgetStore.getState().widgets;
        /*
         * Collect what CHANGED while we were away, then alert ONCE.
         *
         * Per-widget notification here would fan out: three briefings scheduled
         * for 9am become three toasts, and the third is where the feature gets
         * switched off. Coalescing is the whole reason both OpenClaw and Hermes
         * survive as proactive agents.
         */
        const pending: PendingAlert[] = [];
        for (const widget of local) {
          const remote = server.get(widget.id);
          // Newer refreshedAt wins: the scheduler rendered while we were away.
          if (remote && (remote.refreshedAt ?? 0) > (widget.refreshedAt ?? 0)) {
            const previous = widget.render ?? null;
            useWidgetStore.getState().updateWidget(widget.id, {
              render: remote.render,
              refreshedAt: remote.refreshedAt,
            });
            /*
             * Only tiles whose CONTENT moved, and only those asked to
             * interrupt. The unread mark is unconditional and handled by
             * `isUnread` — quiet hours and this toggle govern interruption, not
             * record, so a muted widget still shows "new".
             */
            const change = judgeChange(previous, remote.render ?? null);
            if (change.changed && widget.notifyOnChange) {
              pending.push({
                widgetId: widget.id,
                headline: changeHeadline(widget.title, previous, remote.render ?? null),
              });
            }
          }
        }

        if (pending.length > 0 && !cancelled) {
          const decision = decideAlert(pending, { notify: true, quietHours }, new Date(), APP_NAME);
          if (decision.deliver) {
            notifyRef.current(decision.digest.title, decision.digest.body);
          }
        }
      } catch {
        // Offline / server starting — the next pull will catch up.
      }
    };

    const push = async () => {
      if (pushInFlight.current) return;
      const widgets = useWidgetStore.getState().widgets;
      const snapshot = JSON.stringify(widgets.map((w) => [w.id, w.recipe, w.enabled, w.refreshEverySeconds, w.refreshedAt]));
      if (snapshot === lastPushed.current) return; // nothing material changed
      pushInFlight.current = true;
      try {
        await fetch('/api/schedule/widgets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgets }),
        });
        lastPushed.current = snapshot;
      } catch {
        // Retry on the next change or tick.
      } finally {
        pushInFlight.current = false;
      }
    };

    // Initial sync once the store has rehydrated (rehydrate may be sync).
    void Promise.resolve(useWidgetStore.persist.rehydrate()).then(() => {
      void pull().then(push);
    });

    // PUSH on every store change (debounced by the snapshot comparison).
    const unsub = useWidgetStore.subscribe(() => void push());

    // PULL on the minute tick so renders land while the window is open too.
    const api = (window as unknown as { electronAPI?: { onMinuteTick?: (cb: (ts: number) => void) => void } }).electronAPI;
    api?.onMinuteTick?.(() => void pull());

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
}
