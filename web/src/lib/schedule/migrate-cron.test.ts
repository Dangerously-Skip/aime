import { describe, it, expect } from 'vitest';
import { cronJobToOrder, migrationPlan } from './migrate-cron';
import { attendedJobs } from './attended-jobs';
import { isJobDue } from './due';

/**
 * THE FAILURE TO DESIGN AGAINST IS NOT DATA LOSS — IT IS A THUNDERING HERD.
 *
 * An interval job with no `lastRun` is due immediately by design. A migration
 * that drops or zeroes that field makes every job look due on the very next
 * tick, and the user's morning is twenty simultaneous agent runs costing real
 * money — with the scheduler, not the migration, looking like the culprit.
 */

/*
 * MID-MINUTE, deliberately. At :00, "five seconds ago" is the PREVIOUS minute,
 * so the same-minute guard correctly does not apply and the double-fire test
 * asserts the opposite of what it means. The order tests carry the same note —
 * it cost a flaky 8% failure rate there before it was understood.
 */
const NOW = new Date('2026-08-23T09:00:30.000Z').getTime();

const cronJob = (over = {}) => ({
  id: 'c1', expression: '* * * * *', prompt: 'check the build',
  surfaceId: 'code', lastRun: null as number | null, enabled: true, ...over,
});

describe('the herd guard', () => {
  it('a job that has NEVER run is stamped as run now, not left empty', () => {
    // The single most important line in the migration.
    expect(cronJobToOrder(cronJob({ lastRun: null }), NOW).lastRun).toBe(NOW);
  });

  it('so a freshly migrated job is NOT due on the next tick', () => {
    /*
     * Proven through the real due-check rather than by reading the field: it is
     * `isJobDue` that decides, and the guard only matters if it agrees.
     */
    const order = cronJobToOrder(cronJob({ lastRun: null, expression: '* * * * *' }), NOW);
    expect(isJobDue(order, NOW + 1_000), 'a migrated job fired immediately').toBe(false);
  });

  it('and twenty of them do not all fire at once', () => {
    const jobs = Array.from({ length: 20 }, (_, i) => cronJob({ id: `c${i}`, lastRun: null }));
    const plan = migrationPlan(jobs, [], NOW);
    const dueNow = plan.toAppend.filter((o) => isJobDue(o, NOW + 1_000));
    expect(dueNow, `${dueNow.length} of 20 migrated jobs fired immediately`).toHaveLength(0);
  });

  it('a REAL lastRun is preserved exactly, not overwritten', () => {
    // Losing it would re-fire a job that already ran this minute.
    const ran = NOW - 30_000;
    expect(cronJobToOrder(cronJob({ lastRun: ran }), NOW).lastRun).toBe(ran);
  });

  it('a job that already ran this minute stays not-due after migrating', () => {
    const order = cronJobToOrder(cronJob({ lastRun: NOW - 5_000 }), NOW);
    expect(isJobDue(order, NOW)).toBe(false);
  });
});

describe('what a migrated job becomes', () => {
  it('keeps its id, so the dual-read supersedes rather than duplicates', () => {
    /*
     * A new id would orphan the localStorage copy instead of replacing it, and
     * the renderer would then tick BOTH — the exact double-fire the per-id
     * preference exists to prevent.
     */
    expect(cronJobToOrder(cronJob({ id: 'keep-me' }), NOW).id).toBe('keep-me');
  });

  it('is attended, and keeps its surface', () => {
    const o = cronJobToOrder(cronJob({ surfaceId: 'browser' }), NOW);
    expect(o.attended).toBe(true);
    expect(o.surfaceId).toBe('browser');
    // …so the SERVER will not touch it.
    expect(o.attended).toBe(true);
  });

  it('a disabled job migrates as paused, not silently re-enabled', () => {
    expect(cronJobToOrder(cronJob({ enabled: false }), NOW).status).toBe('paused');
  });

  it('carries the prompt across as the instruction', () => {
    expect(cronJobToOrder(cronJob({ prompt: 'do the thing' }), NOW).instruction).toBe('do the thing');
  });

  it('caps nothing — the cron store never had a cap', () => {
    const o = cronJobToOrder(cronJob(), NOW);
    expect(o.runCount).toBe(0);
    expect(o.maxExecutions).toBeUndefined();
    expect(isJobDue({ ...o, lastRun: undefined }, NOW)).toBe(true);
  });
});

describe('running twice must be harmless', () => {
  /*
   * A reload mid-write, a crash, two windows. Two copies of one cron job is a
   * job that fires twice FOR EVER, which is worse than the migration not
   * running at all.
   */
  it('skips anything the manifest already holds', () => {
    const jobs = [cronJob({ id: 'a' }), cronJob({ id: 'b' })];
    const first = migrationPlan(jobs, [], NOW);
    expect(first.toAppend).toHaveLength(2);

    const second = migrationPlan(jobs, first.toAppend, NOW);
    expect(second.toAppend, 'a second run duplicated jobs').toHaveLength(0);
    expect(second.alreadyPresent.sort()).toEqual(['a', 'b']);
  });

  it('migrates only what is missing when a previous run was partial', () => {
    const jobs = [cronJob({ id: 'a' }), cronJob({ id: 'b' })];
    const partial = migrationPlan([jobs[0]], [], NOW);
    const rest = migrationPlan(jobs, partial.toAppend, NOW);
    expect(rest.migratedIds).toEqual(['b']);
  });

});

describe('the handover, end to end', () => {
  it('a migrated job is ticked once, from the manifest', () => {
    /*
     * The state that actually occurs: the order is in the manifest AND the cron
     * store still holds its copy, because step 5 has not deleted it yet.
     */
    const job = cronJob({ id: 'both' });
    const order = cronJobToOrder(job, NOW);
    const ticked = attendedJobs([order], [job]);
    expect(ticked, 'the job would be ticked twice').toHaveLength(1);
    expect(ticked[0].source).toBe('manifest');
  });

  it('an un-migrated job keeps firing from the cron store meanwhile', () => {
    const migrated = cronJob({ id: 'done' });
    const pending = cronJob({ id: 'pending' });
    const ticked = attendedJobs([cronJobToOrder(migrated, NOW)], [migrated, pending]);
    expect(ticked.map((j) => j.id).sort()).toEqual(['done', 'pending']);
  });
});
