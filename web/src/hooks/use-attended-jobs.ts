'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCronStore } from '@/stores/cron-store';
import { attendedJobs, type AttendedJob, type ManifestOrderLike } from '@/lib/schedule/attended-jobs';
import { createAttendedJob, setJobEnabled, deleteJob, type NewAttendedJob } from '@/lib/schedule/write';

/**
 * The scheduled jobs a user can see and edit, from wherever they live.
 *
 * DR-24 step 5. The creation UI both LISTED and WROTE the browser cron store, so
 * moving only the writes would have produced jobs the panel could not show. This
 * does both, over the same dual read the ticker uses — so the list a user edits
 * and the list that fires are the same list, which was not previously true for
 * standing orders at all.
 *
 * WHY THE WRITES REFETCH RATHER THAN PATCH LOCALLY. An optimistic update here
 * would have to reproduce the manifest's merge rules — the API keeps
 * server-owned execution results when the server ran more recently — and a
 * client that guesses at those will eventually show a job as active that the
 * server has completed. Refetching is one round trip against a local server.
 */
export interface UseAttendedJobs {
  jobs: AttendedJob[];
  loading: boolean;
  /** Null id ⇒ the write did not land, and the caller must say so. */
  create: (job: NewAttendedJob) => Promise<string | null>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useAttendedJobs(): UseAttendedJobs {
  const cronJobs = useCronStore((s) => s.jobs);
  const removeCronJob = useCronStore((s) => s.removeJob);
  const toggleCronJob = useCronStore((s) => s.toggleJob);
  const [orders, setOrders] = useState<ManifestOrderLike[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/orders');
      if (!res.ok) return;
      const data = (await res.json()) as { orders?: ManifestOrderLike[] };
      if (Array.isArray(data.orders)) setOrders(data.orders);
    } catch {
      // Offline or starting. The cron store still lists, which is the
      // pre-migration view — degrading to it is the right failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(
    async (job: NewAttendedJob) => {
      const id = await createAttendedJob(job);
      if (id) await refresh();
      return id;
    },
    [refresh],
  );

  /*
   * Editing reaches BOTH stores, because a job that has not migrated yet still
   * lives in localStorage — and pausing something that then keeps firing is
   * worse than the feature not existing. Which store holds it is not the user's
   * problem, and `source` is how we know without asking.
   */
  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const job = attendedJobs(orders, cronJobs).find((j) => j.id === id);
      if (job?.source === 'cron-store') {
        toggleCronJob(id);
        return true;
      }
      const ok = await setJobEnabled(id, enabled);
      if (ok) await refresh();
      return ok;
    },
    [orders, cronJobs, toggleCronJob, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const job = attendedJobs(orders, cronJobs).find((j) => j.id === id);
      if (job?.source === 'cron-store') {
        removeCronJob(id);
        return true;
      }
      const ok = await deleteJob(id);
      if (ok) await refresh();
      return ok;
    },
    [orders, cronJobs, removeCronJob, refresh],
  );

  return { jobs: attendedJobs(orders, cronJobs), loading, create, setEnabled, remove, refresh };
}
