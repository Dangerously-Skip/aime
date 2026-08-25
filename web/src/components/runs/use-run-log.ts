"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRunStore } from "@/stores/run-store";
import type { Run } from "@/lib/runs/types";

/**
 * Every run this workspace has recorded, durable log merged with in-flight.
 *
 * Extracted from `cockpit.tsx` when the ad-hoc run log moved to the Activity
 * tab — both tabs need the same runs, and two copies of this fetch would drift
 * the moment one of them learned something the other did not.
 *
 * It reads `/api/runs` rather than the client store because the store only
 * holds this session: a run that happened while the window was closed exists
 * only in the durable log. The store is still consulted for RUNNING runs, which
 * by definition exist nowhere else yet.
 */
export interface RunLog {
  /** Durable + live, merged by id. */
  runs: Run[];
  /** A clock that ticks every 30s so relative times stay honest without refetching. */
  now: number;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useRunLog(): RunLog {
  const liveRuns = useRunStore((s) => s.runs);
  const [logged, setLogged] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs?limit=500");
      const data = await res.json();
      setLogged(Array.isArray(data.runs) ? (data.runs as Run[]) : []);
    } catch {
      // Offline or starting up. An empty list is honest; stale runs with live
      // costs attached would not be.
      setLogged([]);
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * The durable log holds completed runs; the store holds in-flight ones. Merge
   * by id with the live copy winning, so a run that is still going shows as
   * running rather than being absent until it lands.
   */
  const runs = useMemo(() => {
    const byId = new Map<string, Run>();
    for (const r of logged) byId.set(r.id, r);
    for (const r of liveRuns) byId.set(r.id, r);
    return [...byId.values()];
  }, [logged, liveRuns]);

  return { runs, now, loading, reload };
}
