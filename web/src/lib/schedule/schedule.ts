/**
 * Schedules as people say them, and the triggers the tickers run.
 *
 * Every place that takes a schedule — the order editor, template dialogs, a
 * project's automations — goes through `SchedulePicker`, which edits a
 * `ScheduleSpec` and stores the `Trigger` this module derives from it. The
 * tickers never see a spec; they see the same `{type, expression}` they always
 * have, so nothing already saved needs migrating.
 *
 * And every place that SHOWS a schedule goes through `describeTrigger` and
 * `nextRunForTrigger`, so "Weekdays at 9:00 AM · next run Mon 9:00 AM" is the
 * same sentence in the sidebar, the editor and the Cockpit — and is computed by
 * the same parsers the tickers use, so it cannot promise a run that never comes.
 *
 * Pure and import-free apart from its siblings, so the server can use it.
 */
import { parseIntervalMs, canonicalInterval, describeIntervalMs } from './interval';
import { parseCron, describeCron, nextCronRun, formatClock } from './cron';

export interface Trigger {
  type: 'cron' | 'interval' | 'event';
  expression?: string;
  event?: string;
}

export type ScheduleSpec =
  | { kind: 'every-minutes'; every: number }
  | { kind: 'every-hours'; every: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; day: number; time: string }
  /** Cron (`*\/10 9-17 * * 1-5`) or an interval (`90m`) — whichever parses. */
  | { kind: 'custom'; expression: string };

export type ScheduleKind = ScheduleSpec['kind'];

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  'every-minutes': 'Every N minutes',
  'every-hours': 'Every N hours',
  daily: 'Every day at…',
  weekdays: 'Weekdays at…',
  weekly: 'Weekly on…',
  custom: 'Custom (cron)',
};

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `HH:MM`, 24-hour — what `<input type="time">` produces. */
export function parseTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Null when the spec can be saved, otherwise why not. */
export function validateSpec(spec: ScheduleSpec): string | null {
  switch (spec.kind) {
    case 'every-minutes':
      return Number.isInteger(spec.every) && spec.every >= 1 && spec.every <= 1440
        ? null
        : 'Minutes must be a whole number from 1 to 1440';
    case 'every-hours':
      return Number.isInteger(spec.every) && spec.every >= 1 && spec.every <= 168
        ? null
        : 'Hours must be a whole number from 1 to 168';
    case 'daily':
    case 'weekdays':
      return parseTime(spec.time) ? null : 'Pick a time';
    case 'weekly':
      if (!Number.isInteger(spec.day) || spec.day < 0 || spec.day > 6) return 'Pick a day';
      return parseTime(spec.time) ? null : 'Pick a time';
    case 'custom':
      return validateTrigger(customTrigger(spec.expression));
  }
}

function customTrigger(expression: string): Trigger {
  const text = expression.trim();
  return parseIntervalMs(text) !== null
    ? { type: 'interval', expression: text }
    : { type: 'cron', expression: text };
}

/** The trigger a spec stores. Assumes `validateSpec(spec) === null`. */
export function specToTrigger(spec: ScheduleSpec): Trigger {
  const clock = (time: string) => {
    const t = parseTime(time) ?? { hour: 9, minute: 0 };
    return `${t.minute} ${t.hour}`;
  };
  switch (spec.kind) {
    case 'every-minutes':
      return { type: 'interval', expression: canonicalInterval(spec.every * 60_000) };
    case 'every-hours':
      return { type: 'interval', expression: canonicalInterval(spec.every * 3_600_000) };
    case 'daily':
      return { type: 'cron', expression: `${clock(spec.time)} * * *` };
    case 'weekdays':
      return { type: 'cron', expression: `${clock(spec.time)} * * 1-5` };
    case 'weekly':
      return { type: 'cron', expression: `${clock(spec.time)} * * ${spec.day}` };
    case 'custom': {
      const t = customTrigger(spec.expression);
      // Normalise an interval so every reader, including an older build, accepts it.
      const ms = t.type === 'interval' ? parseIntervalMs(t.expression) : null;
      return ms !== null ? { type: 'interval', expression: canonicalInterval(ms) } : t;
    }
  }
}

/**
 * The friendliest spec that reproduces a stored trigger, so the picker opens on
 * "Weekdays at 9:00" rather than on the cron it was saved as. Anything without a
 * preset shape opens as Custom with its expression intact.
 */
export function triggerToSpec(trigger: Trigger | undefined): ScheduleSpec {
  const expression = trigger?.expression?.trim() ?? '';
  if (trigger?.type === 'interval') {
    const ms = parseIntervalMs(expression);
    if (ms !== null && ms % 3_600_000 === 0 && ms / 3_600_000 <= 168) {
      return { kind: 'every-hours', every: ms / 3_600_000 };
    }
    if (ms !== null && ms % 60_000 === 0 && ms / 60_000 <= 1440) {
      return { kind: 'every-minutes', every: ms / 60_000 };
    }
    return { kind: 'custom', expression };
  }
  if (trigger?.type === 'cron') {
    const r = parseCron(expression);
    if (r.ok) {
      const c = r.cron;
      const allMonths = c.months.size === 12;
      if (c.minutes.size === 1 && c.hours.size === 1 && !c.domRestricted && allMonths) {
        const time = `${pad([...c.hours][0])}:${pad([...c.minutes][0])}`;
        const dows = [...c.daysOfWeek].sort((a, b) => a - b);
        if (!c.dowRestricted) return { kind: 'daily', time };
        if (dows.join() === '1,2,3,4,5') return { kind: 'weekdays', time };
        if (dows.length === 1) return { kind: 'weekly', day: dows[0], time };
      }
    }
    return { kind: 'custom', expression };
  }
  return { kind: 'daily', time: '09:00' };
}

/** Null when the tickers can run this trigger, otherwise why they cannot. */
export function validateTrigger(trigger: Trigger | undefined): string | null {
  if (!trigger) return 'No schedule';
  switch (trigger.type) {
    case 'interval':
      return parseIntervalMs(trigger.expression) !== null
        ? null
        : `"${trigger.expression ?? ''}" is not an interval — try 5m, 90 minutes or 2h`;
    case 'cron': {
      const r = parseCron(trigger.expression);
      return r.ok ? null : r.error;
    }
    case 'event':
      return trigger.event?.trim() ? null : 'Name the event this runs on';
    default:
      return 'Unknown schedule type';
  }
}

/** One sentence: `Weekdays at 9:00 AM`, `Every 90 minutes`, `On build-failed`. */
export function describeTrigger(trigger: Trigger | undefined): string {
  if (!trigger) return 'No schedule';
  if (trigger.type === 'event') return trigger.event ? `On ${trigger.event}` : 'On an event';
  if (validateTrigger(trigger)) return `Invalid schedule (${trigger.expression ?? ''})`;
  if (trigger.type === 'interval') return describeIntervalMs(parseIntervalMs(trigger.expression)!);
  return describeCron(trigger.expression!) ?? `Custom schedule (${trigger.expression})`;
}

/** The facts about a job that decide when it next runs. */
export interface RunTiming {
  status?: string;
  lastRun?: number;
  createdAt?: number;
  runCount?: number;
  maxExecutions?: number;
  expiresAt?: number;
}

/**
 * When will this run next, in ms — or null for "not scheduled" (paused, done,
 * event-driven, invalid, or a cron that never matches).
 *
 * Mirrors `isJobDue`: an interval counts from its last run, or from creation if
 * it has never run. An overdue interval reports `now` — it fires on the next tick.
 */
export function nextRunForTrigger(trigger: Trigger | undefined, timing: RunTiming, now: number): number | null {
  if (!trigger || validateTrigger(trigger)) return null;
  if (timing.status && timing.status !== 'active') return null;
  if (timing.maxExecutions && (timing.runCount ?? 0) >= timing.maxExecutions) return null;

  let next: number | null = null;
  if (trigger.type === 'interval') {
    const ms = parseIntervalMs(trigger.expression)!;
    const base = timing.lastRun ?? timing.createdAt;
    next = base === undefined ? now : Math.max(now, base + ms);
  } else if (trigger.type === 'cron') {
    next = nextCronRun(trigger.expression!, new Date(now))?.getTime() ?? null;
  }
  if (next !== null && timing.expiresAt && next >= timing.expiresAt) return null;
  return next;
}

/** `Today 9:00 AM`, `Tomorrow 9:00 AM`, `Mon 3 Nov, 9:00 AM`. */
export function formatNextRun(at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  const time = formatClock(d.getHours(), d.getMinutes());
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  const day = WEEKDAY_NAMES[d.getDay()].slice(0, 3);
  const month = d.toLocaleString('en', { month: 'short' });
  return `${day} ${d.getDate()} ${month}, ${time}`;
}
