import { describe, it, expect } from 'vitest';
import { attendedJobs, fromCronJob, fromManifestOrder } from './attended-jobs';
import { isJobDue } from './due';

/**
 * NO WINDOW WHERE A JOB LIVES SOMEWHERE NOTHING READS (DR-24 step 3).
 *
 * Cron jobs are in browser localStorage, standing orders on disk, and the
 * migration moves the former into the latter. The failure to design against is
 * not data loss — it is a job that quietly stops firing because it was written
 * to one store while the ticker read the other.
 *
 * Dual-read makes every intermediate state safe, including a rollback.
 */

const cronJob = (over = {}) => ({
  id: 'c1', expression: '* * * * *', prompt: 'check the build',
  surfaceId: 'code', lastRun: null, enabled: true, ...over,
});

const order = (over = {}) => ({
  id: 'o1', instruction: 'check the build', attended: true, surfaceId: 'code',
  trigger: { type: 'cron' as const, expression: '* * * * *' },
  status: 'active', runCount: 0, ...over,
});

describe('reading both stores', () => {
  it('uses the cron store before anything has migrated', () => {
    const jobs = attendedJobs([], [cronJob()]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe('cron-store');
    expect(jobs[0].prompt).toBe('check the build');
  });

  it('uses the manifest once a job is there', () => {
    const jobs = attendedJobs([order()], []);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe('manifest');
  });

  it('the manifest WINS on a collision, so a half-migrated job fires once', () => {
    /*
     * The state that exists during migration: the job is in the manifest and its
     * localStorage copy has not been cleared. Without preferring by id, one
     * renderer ticks it twice in the same minute.
     */
    const jobs = attendedJobs([order({ id: 'same' })], [cronJob({ id: 'same' })]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe('manifest');
  });

  it('keeps un-migrated cron jobs alongside migrated ones', () => {
    const jobs = attendedJobs([order({ id: 'migrated' })], [cronJob({ id: 'not-yet' })]);
    expect(jobs.map((j) => j.id).sort()).toEqual(['migrated', 'not-yet']);
  });

  it('a rollback still works — an empty manifest falls straight back', () => {
    expect(attendedJobs([], [cronJob(), cronJob({ id: 'c2' })])).toHaveLength(2);
  });
});

describe('unattended orders are NOT the renderer to run', () => {
  it('excludes them', () => {
    /*
     * The server owns these. Picking one up here is the double-fire the whole
     * ownership split exists to prevent, arriving from the other direction.
     */
    expect(attendedJobs([order({ id: 'server-job', attended: false })], [])).toEqual([]);
    expect(attendedJobs([order({ id: 'legacy', attended: undefined })], [])).toEqual([]);
  });

  it('an unattended order does not shadow a cron job of the same id', () => {
    // It must not claim the id and then decline to run it — that would silence
    // the job entirely.
    const jobs = attendedJobs([order({ id: 'same', attended: false })], [cronJob({ id: 'same' })]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe('cron-store');
  });
});

describe('the translation preserves what the due-check needs', () => {
  it('a disabled cron job is paused, not active', () => {
    expect(fromCronJob(cronJob({ enabled: false })).status).toBe('paused');
    expect(isJobDue(fromCronJob(cronJob({ enabled: false })), Date.now())).toBe(false);
  });

  it('carries lastRun across, so the same-minute guard still holds', () => {
    const at = new Date('2026-07-27T12:34:30.000Z').getTime();
    const job = fromCronJob(cronJob({ lastRun: at - 5_000 }));
    expect(isJobDue(job, at), 'the double-fire guard was lost in translation').toBe(false);
  });

  it('null lastRun becomes undefined, not zero', () => {
    // Zero is a real timestamp in 1970 and would defeat the guard silently.
    expect(fromCronJob(cronJob({ lastRun: null })).lastRun).toBeUndefined();
  });

  it('carries the manifest cap and expiry, which cron jobs never had', () => {
    const o = fromManifestOrder(order({ maxExecutions: 3, runCount: 3, expiresAt: 1 }));
    expect(o.maxExecutions).toBe(3);
    expect(isJobDue(o, Date.now())).toBe(false);
  });

  it('keeps the surface, because an attended job exists to drive one', () => {
    expect(fromManifestOrder(order({ surfaceId: 'browser' })).surfaceId).toBe('browser');
    expect(fromCronJob(cronJob({ surfaceId: 'browser' })).surfaceId).toBe('browser');
  });
});
