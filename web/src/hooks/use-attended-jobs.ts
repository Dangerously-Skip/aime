'use client';

import { useCallback, useEffect, useState } from 'react';
import { attendedJobs, type AttendedJob, type ManifestOrderLike } from '@/lib/schedule/attended-jobs';
import { createAttendedJob, setJobEnabled, deleteJob, type NewAttendedJob } from '@/lib/schedule/write';

/**
 * The scheduled jobs a user can see and edit.
 *
 * ONE STORE NOW (DR-24 step 6). This briefly read two — the order manifest and
 * a browser cron store — because a migration was moving jobs from one to the
 * other and neither could be the sole source while that was true.
 *
 * There turned out to be no data worth migrating, so the compatibility layer
 * came out: the per-id merge, the both-stores editing path, the `source`
 * discrimination and the migration itself. That machinery was correct and is
 * simply unnecessary, which is the better reason to delete something than
 * finding it wrong.
 *
 * WHY THE WRITES REFETCH RATHER THAN PATCH LOCALLY. An optimistic update would
 * have to reproduce the manifest's merge rules — the API keeps server-owned
 * execution results when the server ran more recently — and a client that
 * guesses at those will eventually show a job as active that the server has
 * completed. Refetching is one round trip against a local server.
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
  const [orders, setOrders] = useState<ManifestOrderLike[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/orders');
      if (!res.ok) return;
      const data = (await res.json()) as { orders?: ManifestOrderLike[] };
      if (Array.isArray(data.orders)) setOrders(data.orders);
    } catch {
      // Offline or starting up. An empty list is honest — better than showing
      // stale jobs the user might then try to edit.
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

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const ok = await setJobEnabled(id, enabled);
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await deleteJob(id);
      if (ok) await refresh();
      return ok;
    },
    [refresh],
  );

  return { jobs: attendedJobs(orders), loading, create, setEnabled, remove, refresh };
}
