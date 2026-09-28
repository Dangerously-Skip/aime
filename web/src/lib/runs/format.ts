/**
 * Presentation helpers for runs. Pure and unit-testable, so the Cockpit
 * component stays about layout rather than arithmetic.
 */
import type { GoalSchedule, Run, RunStatus, RunSummary } from './types';
import { describeTrigger, nextRunForTrigger, type Trigger } from '@/lib/schedule/schedule';
import { canonicalInterval } from '@/lib/schedule/interval';

/** Compact duration: 850ms, 3.2s, 1m 04s, 2h 11m. */
export function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * Money, honestly. Sub-cent amounts still read as a number rather than $0.00,
 * because "free" and "very cheap" are different facts and a cost dashboard that
 * rounds everything to zero is worse than useless.
 */
export function formatUsd(usd?: number): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n?: number): string {
  if (n == null) return '—';
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Relative time, given an explicit `now` so it stays pure and testable. */
export function formatRelative(ts: number | undefined, now: number): string {
  if (ts == null) return 'never';
  const diff = now - ts;
  if (diff < 0) return 'scheduled';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Time until the next fire, e.g. "in 4m". */
export function formatUntil(ts: number | undefined, now: number): string {
  if (ts == null) return '—';
  const diff = ts - now;
  if (diff <= 0) return 'due now';
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'in <1m';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.floor(hours / 24)}d`;
}

type GoalTiming = {
  enabled: boolean;
  lastRunAt?: number;
  createdAt?: number;
  schedule?: GoalSchedule;
};

/** A goal's schedule as the trigger the tickers run — one vocabulary for both. */
function goalTrigger(schedule?: GoalSchedule): Trigger | null {
  if (schedule?.cron) return { type: 'cron', expression: schedule.cron };
  if (schedule?.everySeconds && schedule.everySeconds > 0) {
    return { type: 'interval', expression: canonicalInterval(schedule.everySeconds * 1_000) };
  }
  return null;
}

/**
 * When a goal next fires, or undefined when it is not scheduled.
 *
 * Computed by the SAME parsers the tickers use (`lib/schedule`), cron included —
 * this used to handle intervals only and show a cron goal's raw expression, and
 * to read its own looser interval grammar, which is how the Cockpit could
 * promise a next run for an order that never fired.
 */
export function nextRunAt(goal: GoalTiming, now: number): number | undefined {
  const trigger = goalTrigger(goal.schedule);
  if (!trigger) return undefined;
  return (
    nextRunForTrigger(
      trigger,
      { status: goal.enabled ? 'active' : 'paused', lastRun: goal.lastRunAt, createdAt: goal.createdAt },
      now,
    ) ?? undefined
  );
}

/** `Weekdays at 9:00 AM`, `Every 90 minutes`, or `Manual`. */
export function describeGoalSchedule(goal: { schedule?: GoalSchedule }): string {
  const trigger = goalTrigger(goal.schedule);
  return trigger ? describeTrigger(trigger) : 'Manual';
}

export type StatusTone = 'success' | 'danger' | 'warn' | 'info' | 'neutral';

export function statusTone(status: RunStatus): StatusTone {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'timeout':
      return 'warn';
    case 'running':
      return 'info';
    case 'awaiting_approval':
      return 'warn';
    default:
      return 'neutral';
  }
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timeout: 'Timed out',
  awaiting_approval: 'Needs approval',
};

/**
 * One-line health sentence for a goal. This is the thing Burnbox could not say:
 * it discarded run outcomes, so a widget that had failed forty times looked
 * identical to one that had simply never run.
 */
export function healthLine(summary: RunSummary, now: number): string {
  if (summary.total === 0) return 'No runs yet';
  const when = formatRelative(summary.lastRun?.startedAt, now);
  if (summary.currentlyFailing) {
    const streak = summary.failed;
    return streak > 1 ? `Failing — ${streak} failures, last ${when}` : `Failed ${when}`;
  }
  if (summary.successRate == null) return `Running now, started ${when}`;
  const pct = Math.round(summary.successRate * 100);
  return pct === 100 ? `Healthy — last run ${when}` : `${pct}% success — last run ${when}`;
}

/** Newest-first ordering by start time. */
export function byNewest(a: Run, b: Run): number {
  return b.startedAt - a.startedAt;
}
