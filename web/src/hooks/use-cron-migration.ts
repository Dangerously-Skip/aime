'use client';

import { useEffect, useRef } from 'react';
import { useCronStore } from '@/stores/cron-store';
import { migrationPlan } from '@/lib/schedule/migrate-cron';
import type { ManifestOrderLike } from '@/lib/schedule/attended-jobs';

/**
 * Move cron jobs into the order manifest, once (DR-24 step 4).
 *
 * WHY THE RENDERER RUNS IT. The cron store is browser localStorage, so the
 * renderer is the only thing that can read it. The server cannot migrate data it
 * cannot see.
 *
 * ORDER OF OPERATIONS IS THE WHOLE RISK, and it is not the obvious one. Losing a
 * job would be recoverable — the localStorage copy stays until step 5. What is
 * not recoverable so easily is a job firing TWICE, or twenty firing at once. So:
 *
 *   1. read both stores
 *   2. skip anything the manifest already holds — a second run must be harmless
 *   3. write the manifest and WAIT for it
 *   4. only then does the ticker see the new orders
 *
 * Step 3 waiting matters: the ticker pulls the manifest on an interval, so
 * returning before the write landed would leave a window where the job is in
 * neither list, and an interval job that reappears with no `lastRun` is due
 * immediately.
 *
 * THE CRON STORE IS NOT CLEARED HERE. The dual read prefers the manifest per id,
 * so the leftover copy is inert, and leaving it means a rollback still has the
 * jobs. Step 5 removes it a release later.
 */
export function useCronMigration(): void {
  // Once per mount, and guarded because two windows can race the same migration.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      const cronJobs = useCronStore.getState().jobs;
      if (cronJobs.length === 0) return; // nothing to move

      let existing: ManifestOrderLike[] = [];
      try {
        const res = await fetch('/api/schedule/orders');
        if (!res.ok) return; // try again next launch rather than guess
        const data = (await res.json()) as { orders?: ManifestOrderLike[] };
        existing = Array.isArray(data.orders) ? data.orders : [];
      } catch {
        return; // server starting; the cron store still ticks meanwhile
      }

      /*
       * IDEMPOTENCE LIVES IN `migrationPlan`, which skips any id the manifest
       * already holds — so an empty plan IS "already migrated". A separate
       * `isMigrated` check here read as a second safeguard and was not one:
       * deleting it failed no test, because it could not change the outcome.
       */
      const plan = migrationPlan(cronJobs, existing, Date.now());
      if (plan.toAppend.length === 0) return;

      try {
        const res = await fetch('/api/schedule/orders', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          /*
           * The FULL list. The route merges rather than replaces, but sending
           * only the additions would still read as a deletion of everything
           * else to any future implementation that does replace.
           */
          body: JSON.stringify({ orders: [...existing, ...plan.toAppend] }),
        });
        if (!res.ok) {
          console.warn('[cron] migration write failed; will retry next launch');
          return;
        }
        console.info(`[cron] migrated ${plan.migratedIds.length} job(s) to the order manifest`);
      } catch (e) {
        // Left un-migrated on purpose: the cron store still ticks them, so the
        // user loses nothing and the next launch tries again.
        console.warn('[cron] migration failed; jobs still run from the cron store', e);
      }
    })();
  }, []);
}
