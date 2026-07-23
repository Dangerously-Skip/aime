'use client';

import { useEffect, useRef } from 'react';
import { useCronStore, matchesCron } from '@/stores/cron-store';

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
  onFireRef.current = onFire;

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = (ts: number) => {
      const now = new Date(ts);
      // Read jobs from the store at tick time — no stale closure, no re-register
      const { jobs, markRan } = useCronStore.getState();
      for (const job of jobs) {
        if (!job.enabled) continue;
        if (matchesCron(job.expression, now)) {
          markRan(job.id);
          onFireRef.current({ id: job.id, prompt: job.prompt, surfaceId: job.surfaceId });
        }
      }
    };

    const unsubscribe = api.onMinuteTick(handler);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
}
