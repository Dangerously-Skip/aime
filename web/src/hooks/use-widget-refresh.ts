'use client';

import { useEffect, useRef } from 'react';
import { useWidgetStore } from '@/stores/widget-store';
import { useRunStore } from '@/stores/run-store';
import { isIntervalDue } from '@/lib/runs/runs';
import { widgetToGoal } from '@/lib/widgets/widget';
import type { Run } from '@/lib/runs/types';

/**
 * Scheduled widget refresh. On each minute tick, refresh every enabled widget
 * whose interval has elapsed — through the same /api/widgets/refresh path as a
 * manual refresh, so scheduled and manual runs are indistinguishable in the log.
 *
 * Same discipline as useStandingOrders: register the tick listener ONCE for the
 * hook's lifetime (re-registering leaked ipcRenderer listeners in older
 * preloads), read the store at tick time, and hold a per-widget in-flight set so
 * a slow refresh can't overlap itself.
 */
export function useWidgetRefresh() {
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onMinuteTick?: (cb: (ts: number) => void) => void } }).electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = async (ts: number) => {
      const widgets = useWidgetStore.getState().widgets;
      for (const widget of widgets) {
        if (inFlightRef.current.has(widget.id)) continue;
        if (!isIntervalDue(widgetToGoal(widget), ts)) continue;

        inFlightRef.current.add(widget.id);
        try {
          const res = await fetch('/api/widgets/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widget }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.node) {
            useWidgetStore.getState().setRender(widget.id, data.node, Date.now());
          } else {
            // The failed run is already in the durable log (the route records
            // it), so the Cockpit shows the failure — the thing Burnbox's
            // eprintln-and-vanish never could. Still stamp refreshedAt via the
            // run so the widget doesn't re-fire every single tick.
            useWidgetStore.getState().updateWidget(widget.id, { refreshedAt: Date.now() });
          }
          if (data.run) {
            const run = data.run as Run;
            useRunStore.setState((s) => ({ runs: [run, ...s.runs.filter((r) => r.id !== run.id)] }));
          }
        } catch {
          // Offline / server down: stamp so we retry next interval, not next tick.
          useWidgetStore.getState().updateWidget(widget.id, { refreshedAt: Date.now() });
        } finally {
          inFlightRef.current.delete(widget.id);
        }
      }
    };

    api.onMinuteTick(handler);
    // NOTE: same caveat as useStandingOrders — older preloads had no
    // unsubscribe; registering once per app lifetime is the contract.
  }, []);
}
