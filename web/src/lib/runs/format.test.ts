import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatUsd,
  formatTokens,
  formatRelative,
  formatUntil,
  nextRunAt,
  describeGoalSchedule,
  statusTone,
  healthLine,
  byNewest,
  approvalPolicyLabel,
  refusalLabel,
} from './format';
import type { Run, RunSummary } from './types';

const NOW = 1_000_000_000;

describe('formatDuration', () => {
  it('scales across ms / s / m / h', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(3_200)).toBe('3.2s');
    expect(formatDuration(64_000)).toBe('1m 04s');
    expect(formatDuration(7_860_000)).toBe('2h 11m');
  });
  it('renders an em dash for unknown', () => {
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatUsd', () => {
  // A cost dashboard that rounds every real charge to $0.00 is worse than none.
  it('keeps sub-cent amounts visible instead of collapsing them to zero', () => {
    expect(formatUsd(0.0004)).toBe('$0.0004');
    expect(formatUsd(0.0123)).toBe('$0.012');
  });
  it('distinguishes genuinely free from very cheap', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00001)).toBe('$0.0000');
  });
  it('uses cents above a dollar', () => {
    expect(formatUsd(12.3456)).toBe('$12.35');
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(940)).toBe('940');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(3_450_000)).toBe('3.45M');
  });
});

describe('formatRelative / formatUntil', () => {
  it('describes the past', () => {
    expect(formatRelative(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
    expect(formatRelative(NOW - 4 * 86_400_000, NOW)).toBe('4d ago');
    expect(formatRelative(undefined, NOW)).toBe('never');
  });
  it('describes the future', () => {
    expect(formatUntil(NOW + 4 * 60_000, NOW)).toBe('in 4m');
    expect(formatUntil(NOW + 5 * 3_600_000, NOW)).toBe('in 5h');
    expect(formatUntil(NOW - 1, NOW)).toBe('due now');
    expect(formatUntil(undefined, NOW)).toBe('—');
  });
});

describe('nextRunAt', () => {
  it('is now for an enabled goal that has never run', () => {
    expect(nextRunAt({ enabled: true, schedule: { everySeconds: 3_600 } }, NOW)).toBe(NOW);
  });
  it('is lastRun + interval once it has run', () => {
    expect(nextRunAt({ enabled: true, lastRunAt: NOW, schedule: { everySeconds: 60 } }, NOW)).toBe(NOW + 60_000);
  });
  it('counts a never-run goal from its creation, like the ticker does', () => {
    expect(nextRunAt({ enabled: true, createdAt: NOW, schedule: { everySeconds: 300 } }, NOW)).toBe(NOW + 300_000);
  });
  it('computes cron goals too instead of leaving them blank', () => {
    const next = nextRunAt({ enabled: true, schedule: { cron: '0 9 * * *' } }, NOW);
    expect(next).toBeGreaterThan(NOW);
    expect(new Date(next!).getHours()).toBe(9);
    expect(new Date(next!).getMinutes()).toBe(0);
  });
  it('is undefined when disabled or not interval-scheduled', () => {
    expect(nextRunAt({ enabled: false, schedule: { everySeconds: 60 } }, NOW)).toBeUndefined();
    expect(nextRunAt({ enabled: true }, NOW)).toBeUndefined();
  });
});

describe('statusTone', () => {
  it('separates failure from timeout and from cancellation', () => {
    expect(statusTone('succeeded')).toBe('success');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('timeout')).toBe('warn');
    expect(statusTone('running')).toBe('info');
    expect(statusTone('cancelled')).toBe('neutral');
    expect(statusTone('awaiting_approval')).toBe('warn');
  });
});

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  total: 0,
  succeeded: 0,
  failed: 0,
  successRate: null,
  totalUsd: 0,
  medianDurationMs: null,
  currentlyFailing: false,
  ...over,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r',
  goalId: 'g',
  trigger: 'cron',
  status: 'succeeded',
  startedAt: NOW - 60_000,
  deliverables: [],
  ...over,
});

describe('healthLine', () => {
  it('says so plainly when nothing has run', () => {
    expect(healthLine(summary(), NOW)).toBe('No runs yet');
  });

  // The thing Burnbox could not say — it discarded outcomes, so a widget that
  // had failed forty times looked identical to one that had never run.
  it('names a failure streak rather than hiding it', () => {
    const line = healthLine(
      summary({ total: 5, succeeded: 1, failed: 4, successRate: 0.2, currentlyFailing: true, lastRun: run() }),
      NOW,
    );
    expect(line).toContain('Failing');
    expect(line).toContain('4 failures');
  });

  it('reports a healthy goal with its last run time', () => {
    const line = healthLine(
      summary({ total: 3, succeeded: 3, successRate: 1, lastRun: run() }),
      NOW,
    );
    expect(line).toBe('Healthy — last run 1m ago');
  });

  it('reports a partial success rate', () => {
    const line = healthLine(
      summary({ total: 4, succeeded: 3, failed: 1, successRate: 0.75, lastRun: run() }),
      NOW,
    );
    expect(line).toContain('75% success');
  });
});

describe('byNewest', () => {
  it('sorts newest first', () => {
    const sorted = [run({ id: 'old', startedAt: 1 }), run({ id: 'new', startedAt: 9 })].sort(byNewest);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old']);
  });
});

describe('describeGoalSchedule', () => {
  it('reads cron and intervals in words, never raw cron', () => {
    expect(describeGoalSchedule({ schedule: { cron: '0 9 * * 1-5' } })).toBe('Weekdays at 9:00 AM');
    expect(describeGoalSchedule({ schedule: { everySeconds: 5_400 } })).toBe('Every 90 minutes');
    expect(describeGoalSchedule({})).toBe('Manual');
  });
});

describe('approvalPolicyLabel', () => {
  // Said as enforced: an unattended run has nobody to ask and nothing resumes it.
  it('says refused, never asks or pauses', () => {
    for (const policy of ['always', 'consequential', 'never'] as const) {
      expect(approvalPolicyLabel(policy)).not.toMatch(/paus|ask you|approval card/i);
    }
    expect(approvalPolicyLabel('consequential')).toMatch(/refused/);
    expect(approvalPolicyLabel('always')).toMatch(/Reads only/);
  });

  it('tells the user the Security settings apply to a run that acts freely', () => {
    expect(approvalPolicyLabel('never')).toMatch(/Security settings apply/);
  });
});

describe('refusalLabel', () => {
  it('counts refused steps, and is null for none — including old records', () => {
    expect(refusalLabel({})).toBeNull();
    expect(refusalLabel({ refusals: [] })).toBeNull();
    expect(refusalLabel({ refusals: [{ tool: 'Write', reason: 'r', at: 1 }] })).toBe('1 step refused');
    expect(
      refusalLabel({ refusals: [{ tool: 'Write', reason: 'r', at: 1 }, { tool: 'Bash', reason: 'r', at: 2 }] }),
    ).toBe('2 steps refused');
  });
});
