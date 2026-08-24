import type { LegacyCronJob, ManifestOrderLike } from './attended-jobs';

/**
 * Move cron jobs into the order manifest, once (DR-24 step 4).
 *
 * THE FAILURE TO DESIGN AGAINST IS NOT DATA LOSS. It is a THUNDERING HERD: an
 * interval job with no `lastRun` is due immediately by design, so a migration
 * that drops or zeroes that field makes every job look due on the very next
 * tick. The user's morning becomes twenty simultaneous agent runs, costing real
 * money, and the cause looks like the scheduler rather than the migration.
 *
 * So `lastRun` is preserved exactly, and a job that has genuinely never run is
 * stamped as having run AT MIGRATION TIME rather than left empty. That delays
 * its first fire by one interval, which is the correct trade: a job firing one
 * cycle late is invisible, and twenty firing at once is not.
 *
 * PURE, so the ordering rules can be tested without a filesystem. The caller
 * does the writing, and the order of those writes matters — see
 * `migrationPlan`'s note on visibility.
 */

/** A cron job, as an order the manifest can hold. */
export function cronJobToOrder(job: LegacyCronJob, nowMs: number): ManifestOrderLike & {
  instruction: string;
  notifyVia: string;
  state: Record<string, unknown>;
  errorCount: number;
  createdAt: number;
  updatedAt: number;
} {
  return {
    // The SAME id. A new one would orphan the localStorage copy rather than
    // supersede it, and the dual-read prefers the manifest per id — so keeping
    // it is what makes the handover seamless.
    id: job.id,
    instruction: job.prompt,
    attended: true,
    surfaceId: job.surfaceId,
    trigger: { type: 'cron', expression: job.expression },
    status: job.enabled ? 'active' : 'paused',
    /*
     * NEVER-RUN BECOMES NOW. This single line is the thundering-herd guard; see
     * the note above. `lastRun: null` in the cron store means "not yet", and
     * carrying that across unchanged would make every migrated job due at once.
     */
    lastRun: job.lastRun ?? nowMs,
    // The cron store never counted runs. Zero is the truthful starting point,
    // and with no `maxExecutions` it caps nothing.
    runCount: 0,
    errorCount: 0,
    notifyVia: 'surface',
    state: {},
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

export interface MigrationPlan {
  /** Orders to append to the manifest. */
  toAppend: ReturnType<typeof cronJobToOrder>[];
  /** Cron job ids that are now represented in the manifest. */
  migratedIds: string[];
  /** Ids skipped because the manifest already has them. */
  alreadyPresent: string[];
}

/**
 * What this migration would do, without doing it.
 *
 * IDEMPOTENT BY CONSTRUCTION. A migration that runs twice — a reload mid-write,
 * a crash, a user with two windows — must not duplicate a job, because two
 * copies of one cron job is a job that fires twice for ever. Anything the
 * manifest already holds is skipped rather than appended.
 */
export function migrationPlan(
  cronJobs: LegacyCronJob[],
  existingOrders: ManifestOrderLike[],
  nowMs: number,
): MigrationPlan {
  const have = new Set(existingOrders.map((o) => o.id));
  const toAppend: ReturnType<typeof cronJobToOrder>[] = [];
  const migratedIds: string[] = [];
  const alreadyPresent: string[] = [];

  for (const job of cronJobs) {
    if (have.has(job.id)) {
      alreadyPresent.push(job.id);
      continue;
    }
    toAppend.push(cronJobToOrder(job, nowMs));
    migratedIds.push(job.id);
  }

  return { toAppend, migratedIds, alreadyPresent };
}

