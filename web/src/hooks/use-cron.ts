'use client';

import { useEffect } from 'react';
import { useCronStore, matchesCron } from '@/stores/cron-store';

declare global {
  interface Window {
    electronAPI?: {
      onMinuteTick?: (callback: (ts: number) => void) => void;
    };
  }
}

/**
 * Evaluates enabled cron jobs on every minute:tick and fires
 * onFire(job) for each job whose expression matches the current time.
 *
 * Call this once in a top-level client component.
 */
export function useCron(
  onFire: (job: { id: string; prompt: string; surfaceId: string }) => void
) {
  const jobs = useCronStore((s) => s.jobs);
  const markRan = useCronStore((s) => s.markRan);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = (ts: number) => {
      const now = new Date(ts);
      for (const job of jobs) {
        if (!job.enabled) continue;
        if (matchesCron(job.expression, now)) {
          markRan(job.id);
          onFire({ id: job.id, prompt: job.prompt, surfaceId: job.surfaceId });
        }
      }
    };

    api.onMinuteTick(handler);
  // Re-register when job list changes so we always evaluate the latest set
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
}
