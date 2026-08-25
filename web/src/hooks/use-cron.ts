'use client';

import { useEffect, useRef } from 'react';
import { isJobDue } from '@/lib/schedule/due';
import { attendedJobs, type ManifestOrderLike } from '@/lib/schedule/attended-jobs';
import { markOrderRan } from '@/lib/schedule/write';

// ElectronAPI type is declared globally in use-electron.ts

/**
 * Evaluates enabled cron jobs on every minute:tick and fires
 * onFire(job) for each job whose expression matches the current time.
 *
 * Call this once in a top-level client component.
 */
export function useCron(
  onFire: (job: { id: string; prompt: string; surfaceId: string }) => void
) {
  // Keep the latest onFire in a ref so the tick handler is registered exactly
  // once. Re-registering per render leaked ipcRenderer listeners (older
  // preloads had no unsubscribe), making each matching job fire once per
  // accumulated listener on every tick.
  const onFireRef = useRef(onFire);
  // Synced in an effect rather than during render (render must stay pure).
  // Declared before the registration effect so the ref is current by the time
  // that one runs; the registration effect keeps its empty dep array, so the
  // listener is still registered exactly once for the hook's lifetime.
  useEffect(() => {
    onFireRef.current = onFire;
  });

  /*
   * The manifest, refreshed between ticks. Held in a ref because the tick
   * handler is registered once and must not close over a stale list.
   */
  const manifestRef = useRef<ManifestOrderLike[]>([]);
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch('/api/schedule/orders');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { orders?: ManifestOrderLike[] };
        if (Array.isArray(data.orders)) manifestRef.current = data.orders;
      } catch {
        // Offline or starting up. The cron store still ticks, which is exactly
        // the pre-migration behaviour — degrading to it is the right failure.
      }
    };
    void pull();
    const id = setInterval(pull, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = (ts: number) => {
      /*
       * ONE STORE (DR-24 step 6). This briefly read the browser cron store as
       * well, while a migration moved jobs across; there turned out to be no
       * data worth migrating, so the compatibility layer came out.
       *
       * The read is async and the tick is not, so the manifest is fetched into
       * a ref between ticks. A tick arriving before the first fetch sees an
       * empty list and does nothing, which is correct: no jobs are known yet.
       */
      const jobs = attendedJobs(manifestRef.current);

      for (const job of jobs) {
        // ONE due-check, shared with the server ticker (step 1).
        if (!isJobDue(job, ts)) continue;

        /*
         * STAMP LOCALLY FIRST, PERSIST AFTER — and the order is the point.
         *
         * `lastRun` is what the same-minute guard reads, and that guard exists
         * because a tick CAN arrive twice inside one minute (a resumed laptop,
         * two listeners, a slow tick). Waiting for the round trip before firing
         * would delay every job by a request; not updating the ref at all would
         * leave the guard reading a stale value until the next 60s refresh, so
         * a double tick fires the job twice.
         *
         * So the in-memory copy moves immediately and the write follows. If the
         * write fails the job may run once more after a refresh — which is the
         * right way round: a job that runs twice is visible, and one silently
         * marked as run is not.
         */
        const order = manifestRef.current.find((o) => o.id === job.id);
        if (order) order.lastRun = ts;
        void markOrderRan(job.id, ts);

        onFireRef.current({ id: job.id, prompt: job.prompt, surfaceId: job.surfaceId });
      }
    };

    const unsubscribe = api.onMinuteTick(handler);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
}
