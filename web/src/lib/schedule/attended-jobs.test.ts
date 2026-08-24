import { describe, it, expect } from 'vitest';
import { attendedJobs, fromManifestOrder } from './attended-jobs';
import { isJobDue } from './due';

/**
 * THE JOBS THE RENDERER TICKS — from the manifest, and only the attended ones.
 *
 * This file used to test a merge of two stores, because a migration was moving
 * cron jobs out of browser localStorage and neither could be the sole source
 * while that was true. There turned out to be no data worth migrating, so the
 * compatibility layer came out (DR-24 step 6) and what remains is the rule that
 * always mattered: ownership.
 */

const order = (over = {}) => ({
  id: 'o1', instruction: 'check the build', attended: true, surfaceId: 'code',
  trigger: { type: 'cron' as const, expression: '* * * * *' },
  status: 'active', runCount: 0, ...over,
});

describe('ownership', () => {
  it('returns attended jobs', () => {
    const jobs = attendedJobs([order()]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].prompt).toBe('check the build');
  });

  it('EXCLUDES unattended orders — those are the server ticker to run', () => {
    /*
     * The load-bearing rule. Picking one up here is a job that fires twice:
     * once in the server pass, once in the renderer. Real money, and on a
     * browsing job, real actions taken twice.
     */
    expect(attendedJobs([order({ attended: false })])).toEqual([]);
    expect(attendedJobs([order({ attended: undefined })])).toEqual([]);
  });

  it('picks the attended ones out of a mixed manifest', () => {
    const jobs = attendedJobs([
      order({ id: 'a' }),
      order({ id: 'b', attended: false }),
      order({ id: 'c' }),
    ]);
    expect(jobs.map((j) => j.id)).toEqual(['a', 'c']);
  });

  it('an empty manifest ticks nothing, rather than throwing', () => {
    expect(attendedJobs([])).toEqual([]);
  });
});

describe('the translation preserves what the due-check needs', () => {
  it('carries lastRun, so the same-minute guard still holds', () => {
    const at = new Date('2026-08-25T12:34:30.000Z').getTime();
    const job = fromManifestOrder(order({ lastRun: at - 5_000 }));
    expect(isJobDue(job, at), 'the double-fire guard was lost in translation').toBe(false);
  });

  it('carries the cap and expiry, which cron jobs never had', () => {
    const capped = fromManifestOrder(order({ maxExecutions: 3, runCount: 3 }));
    expect(isJobDue(capped, Date.now())).toBe(false);
    const expired = fromManifestOrder(order({ expiresAt: 1 }));
    expect(isJobDue(expired, Date.now())).toBe(false);
  });

  it('a paused order is not due', () => {
    expect(isJobDue(fromManifestOrder(order({ status: 'paused' })), Date.now())).toBe(false);
  });

  it('keeps the surface, because an attended job exists to drive one', () => {
    expect(fromManifestOrder(order({ surfaceId: 'browser' })).surfaceId).toBe('browser');
  });

  it('keeps the project, so per-project schedules stay visible there', () => {
    expect(fromManifestOrder(order({ projectId: 'p1' })).projectId).toBe('p1');
    expect(fromManifestOrder(order()).projectId).toBeUndefined();
  });
});
