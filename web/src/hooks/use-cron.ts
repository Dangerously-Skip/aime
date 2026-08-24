'use client';

import { useEffect, useRef } from 'react';
import { useCronStore } from '@/stores/cron-store';
import { isJobDue } from '@/lib/schedule/due';
import { attendedJobs, type ManifestOrderLike } from '@/lib/schedule/attended-jobs';

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
       * BOTH STORES, manifest preferred (DR-24 step 3).
       *
       * Cron jobs are in localStorage and standing orders are on disk, and the
       * migration moves the former into the latter. Reading both means no
       * intermediate state exists where a job lives somewhere nothing ticks —
       * including a rollback, where the manifest is empty and this falls
       * straight back to the store it always used.
       *
       * The read is async and the tick is not, so the manifest is fetched into
       * a ref between ticks; a tick that arrives before the first fetch simply
       * sees the cron store, which is the pre-migration behaviour anyway.
       */
      const { jobs: cronJobs, markRan } = useCronStore.getState();
      const jobs = attendedJobs(manifestRef.current, cronJobs);

      for (const job of jobs) {
        // ONE due-check, shared with the server ticker (step 1).
        if (!isJobDue(job, ts)) continue;
        /*
         * Stamp BEFORE firing, and only where the job actually lives. A manifest
         * job's `lastRun` is the server's record to keep; writing it here would
         * need a round trip the tick cannot wait for, so step 4 moves that with
         * the migration. Until then a migrated job relies on the same-minute
         * guard against the value the manifest already holds.
         */
        if (job.source === 'cron-store') markRan(job.id);
        onFireRef.current({ id: job.id, prompt: job.prompt, surfaceId: job.surfaceId });
      }
    };

    const unsubscribe = api.onMinuteTick(handler);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
}
