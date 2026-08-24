import type { SchedulableJob } from './due';

/**
 * The attended jobs the renderer should tick, from both stores at once.
 *
 * WHY DUAL-READ (DR-24 step 3). Cron jobs live in browser localStorage and
 * standing orders live on disk. The migration moves the former into the latter,
 * and the failure to design against is not data loss — it is a window where a
 * job exists somewhere nothing reads, and simply stops firing.
 *
 * So the renderer reads BOTH and prefers the manifest. Every intermediate state
 * is then safe:
 *
 *   before migration   manifest has no attended jobs; the cron store is used
 *   during             both exist; the manifest wins per id, so no double-fire
 *   after              the cron store is empty; only the manifest is used
 *   rolled back        the cron store is still there, untouched, and works
 *
 * PREFERENCE IS BY ID, not by list. A job migrated to the manifest while its
 * localStorage copy remains would otherwise be ticked twice in the same minute
 * from one renderer — the same double-fire the server/renderer split guards
 * against, arriving from the other direction.
 */

/** A cron job as the browser store holds it. */
export interface LegacyCronJob {
  id: string;
  expression: string;
  prompt: string;
  surfaceId: string;
  lastRun: number | null;
  enabled: boolean;
}

/** What the ticker needs, whichever store it came from. */
export interface AttendedJob extends SchedulableJob {
  id: string;
  prompt: string;
  surfaceId: string;
  /** Which store this came from, so the caller knows where to write `lastRun`. */
  source: 'manifest' | 'cron-store';
}

/** A manifest order, narrowed to what this module reads. */
export interface ManifestOrderLike {
  id: string;
  instruction: string;
  attended?: boolean;
  surfaceId?: string;
  trigger: { type: 'cron' | 'interval' | 'event'; expression?: string };
  status: string;
  lastRun?: number;
  runCount: number;
  maxExecutions?: number;
  expiresAt?: number;
}

/** A legacy cron job in the shared job shape. */
export function fromCronJob(job: LegacyCronJob): AttendedJob {
  return {
    id: job.id,
    prompt: job.prompt,
    surfaceId: job.surfaceId,
    source: 'cron-store',
    // `enabled` is the cron store's spelling of `status`.
    status: job.enabled ? 'active' : 'paused',
    trigger: { type: 'cron', expression: job.expression },
    lastRun: job.lastRun ?? undefined,
    // The cron store has never counted runs or capped them; absent is correct
    // rather than zero-with-a-cap, which would read as "capped at zero".
    runCount: 0,
  };
}

/** A manifest order in the shared job shape. */
export function fromManifestOrder(order: ManifestOrderLike): AttendedJob {
  return {
    id: order.id,
    prompt: order.instruction,
    surfaceId: order.surfaceId ?? '',
    source: 'manifest',
    status: order.status,
    trigger: order.trigger,
    lastRun: order.lastRun,
    runCount: order.runCount,
    maxExecutions: order.maxExecutions,
    expiresAt: order.expiresAt,
  };
}

/**
 * Merge both stores into the list the renderer ticks.
 *
 * Manifest wins on a collision, and UNATTENDED ORDERS ARE EXCLUDED — those are
 * the server's, and picking one up here is the double-fire this whole ownership
 * split exists to prevent.
 */
export function attendedJobs(
  orders: ManifestOrderLike[],
  cronJobs: LegacyCronJob[],
): AttendedJob[] {
  const fromManifest = orders.filter((o) => o.attended === true).map(fromManifestOrder);
  const claimed = new Set(fromManifest.map((j) => j.id));
  const legacy = cronJobs.filter((j) => !claimed.has(j.id)).map(fromCronJob);
  return [...fromManifest, ...legacy];
}
