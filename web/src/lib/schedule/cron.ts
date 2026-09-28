/**
 * Five-field cron: parse, validate, match, find the next run, and say it in words.
 *
 * WHY A REAL PARSER. The old matcher checked the field count and nothing else,
 * then compared each field with `parseInt`. So `0 9 * * MON-FRI` was accepted
 * on save and matched NOTHING, ever — `Number('MON')` is NaN — and `0 9 * * 7`
 * (Sunday in every cron the user has met) never matched either, because
 * `Date.getDay()` has no 7. Both are ordinary things to type and both produced a
 * job that looked scheduled and silently never ran.
 *
 * Now there is one parse, and everything else reads its result: an expression
 * that parses is one that can match, and one that does not is refused at save
 * with a reason instead of accepted and ignored.
 *
 * Semantics follow Vixie cron, which is what people have in their heads:
 *   - names: JAN-DEC, SUN-SAT (case-insensitive), in ranges and lists too
 *   - day-of-week 7 is Sunday, same as 0
 *   - `*` + step counts from the field's minimum (day-of-month `*` + `/2` is 1,3,5…)
 *   - `a/n` means `a-max/n`
 *   - when BOTH day-of-month and day-of-week are restricted, either may match
 *   - @hourly @daily @midnight @weekly @monthly @yearly @annually
 *
 * Pure and import-free, like `due.ts`, so the server ticker can use it.
 */

interface FieldDef {
  label: string;
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const FIELDS: readonly FieldDef[] = [
  { label: 'minute', min: 0, max: 59 },
  { label: 'hour', min: 0, max: 23 },
  { label: 'day of month', min: 1, max: 31 },
  { label: 'month', min: 1, max: 12, names: Object.fromEntries(MONTHS.map((m, i) => [m, i + 1])) },
  // 7 is accepted and folded onto 0 below.
  { label: 'day of week', min: 0, max: 7, names: Object.fromEntries(DAYS.map((d, i) => [d, i])) },
];

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

export interface ParsedCron {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  /** 0-6, Sunday = 0. A 7 in the source is stored as 0. */
  daysOfWeek: ReadonlySet<number>;
  /** Whether the field was anything other than `*` — decides the OR rule. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

export type CronParseResult = { ok: true; cron: ParsedCron } | { ok: false; error: string };

/**
 * An own-property lookup. A plain `obj[key]` on user text reaches the
 * prototype: `__proto__` came back as an object (and `.split` threw), and
 * `constructor` as a function where a number was expected.
 */
function lookup<T>(table: Record<string, T> | undefined, key: string): T | undefined {
  return table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function parseValue(token: string, def: FieldDef): number | null {
  const named = lookup(def.names, token.toLowerCase());
  if (named !== undefined) return named;
  if (!/^\d+$/.test(token)) return null;
  return Number(token);
}

function parseField(source: string, def: FieldDef): Set<number> | string {
  const out = new Set<number>();
  for (const part of source.split(',')) {
    if (!part) return `empty item in the ${def.label} field`;
    const [base, stepText, extra] = part.split('/');
    if (extra !== undefined) return `"${part}" has more than one "/" in the ${def.label} field`;

    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
        return `"${stepText}" is not a valid step in the ${def.label} field`;
      }
      step = Number(stepText);
    }

    let lo: number;
    let hi: number;
    if (base === '*') {
      lo = def.min;
      hi = def.label === 'day of week' ? 6 : def.max;
    } else {
      const [a, b, more] = base.split('-');
      if (more !== undefined) return `"${base}" is not a valid range in the ${def.label} field`;
      const start = parseValue(a, def);
      if (start === null) return `"${a}" is not a valid ${def.label}`;
      lo = start;
      if (b !== undefined) {
        const end = parseValue(b, def);
        if (end === null) return `"${b}" is not a valid ${def.label}`;
        hi = end;
      } else {
        // `5/15` means 5-max/15; a bare `5` is just 5.
        hi = stepText !== undefined ? def.max : start;
      }
    }

    if (lo < def.min || hi > def.max) {
      return `${def.label} must be between ${def.min} and ${def.max}`;
    }
    if (lo > hi) return `"${base}" runs backwards in the ${def.label} field`;

    for (let v = lo; v <= hi; v += step) {
      out.add(def.label === 'day of week' && v === 7 ? 0 : v);
    }
  }
  return out;
}

const parseCache = new Map<string, CronParseResult>();

/** Parse a 5-field expression (or a macro). Never throws. */
export function parseCron(expression: string | null | undefined): CronParseResult {
  if (typeof expression !== 'string') return { ok: false, error: 'Schedule is empty' };
  const key = expression.trim();
  const cached = parseCache.get(key);
  if (cached) return cached;

  const result = parseUncached(key);
  // Bounded: an expression is typed by a person, but a runaway caller must not
  // turn a memo into a leak.
  if (parseCache.size > 500) parseCache.clear();
  parseCache.set(key, result);
  return result;
}

function parseUncached(text: string): CronParseResult {
  if (!text) return { ok: false, error: 'Schedule is empty' };
  const expanded = lookup(MACROS, text.toLowerCase()) ?? text;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `A cron schedule has 5 fields (minute hour day-of-month month day-of-week); this has ${parts.length}`,
    };
  }

  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const r = parseField(parts[i], FIELDS[i]);
    if (typeof r === 'string') return { ok: false, error: r };
    sets.push(r);
  }

  return {
    ok: true,
    cron: {
      minutes: sets[0],
      hours: sets[1],
      daysOfMonth: sets[2],
      months: sets[3],
      daysOfWeek: sets[4],
      domRestricted: parts[2] !== '*',
      dowRestricted: parts[4] !== '*',
    },
  };
}

/** Null when valid, otherwise a sentence a user can act on. */
export function validateCron(expression: string | null | undefined): string | null {
  const r = parseCron(expression);
  return r.ok ? null : r.error;
}

function dayMatches(cron: ParsedCron, date: Date): boolean {
  const dom = cron.daysOfMonth.has(date.getDate());
  const dow = cron.daysOfWeek.has(date.getDay());
  // Vixie rule: both restricted ⇒ either; otherwise the restricted one decides.
  if (cron.domRestricted && cron.dowRestricted) return dom || dow;
  return dom && dow;
}

function matchesParsed(cron: ParsedCron, date: Date): boolean {
  return (
    cron.minutes.has(date.getMinutes()) &&
    cron.hours.has(date.getHours()) &&
    cron.months.has(date.getMonth() + 1) &&
    dayMatches(cron, date)
  );
}

/** Does `date` (local time) match? False for an expression that does not parse. */
export function matchesCron(expression: string, date: Date = new Date()): boolean {
  const r = parseCron(expression);
  return r.ok && matchesParsed(r.cron, date);
}

/**
 * The first matching minute strictly after `from`, or null if there is none
 * within ~5 years (`0 0 30 2 *` — February 30th — parses and never happens).
 *
 * Skips whole months, days and hours that cannot match, so a yearly schedule
 * costs a few hundred steps rather than half a million.
 */
export function nextCronRun(expression: string, from: Date = new Date()): Date | null {
  const r = parseCron(expression);
  if (!r.ok) return null;
  const cron = r.cron;

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  const limit = from.getTime() + 5 * 366 * 86_400_000;
  while (d.getTime() <= limit) {
    if (!cron.months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(cron, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

// ── In words ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `9:00 AM`. Fixed format rather than locale-driven so it reads the same everywhere. */
export function formatClock(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

const sorted = (s: ReadonlySet<number>) => [...s].sort((a, b) => a - b);
const isFull = (s: ReadonlySet<number>, min: number, max: number) => s.size === max - min + 1;
/** A uniform step from the field minimum, e.g. {0,15,30,45} → 15. */
function uniformStep(s: ReadonlySet<number>, min: number, max: number): number | null {
  const v = sorted(s);
  if (v.length < 2 || v[0] !== min) return null;
  const step = v[1] - v[0];
  for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] !== step) return null;
  // Must be the complete progression, not a prefix of it.
  return v[v.length - 1] + step > max ? step : null;
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function describeDays(cron: ParsedCron): string | null {
  const dows = sorted(cron.daysOfWeek);
  const allMonths = isFull(cron.months, 1, 12);
  if (!allMonths) return null;
  if (!cron.domRestricted && !cron.dowRestricted) return 'Every day';
  if (!cron.domRestricted) {
    if (dows.join() === '1,2,3,4,5') return 'Weekdays';
    if (dows.join() === '0,6') return 'Weekends';
    if (dows.length === 1) return `Every ${DAY_NAMES[dows[0]]}`;
    return `Every ${joinWords(dows.map((d) => DAY_SHORT[d]))}`;
  }
  if (!cron.dowRestricted && cron.daysOfMonth.size === 1) {
    return `Monthly on day ${sorted(cron.daysOfMonth)[0]}`;
  }
  return null;
}

/**
 * A sentence for a cron expression — `Weekdays at 9:00 AM`, `Every 15 minutes`.
 * Falls back to `Custom schedule (…)` for shapes with no short English form,
 * and returns null for an expression that does not parse.
 */
export function describeCron(expression: string): string | null {
  const r = parseCron(expression);
  if (!r.ok) return null;
  const cron = r.cron;
  const custom = `Custom schedule (${expression.trim()})`;

  const everyDay = !cron.domRestricted && !cron.dowRestricted && isFull(cron.months, 1, 12);
  const allHours = isFull(cron.hours, 0, 23);
  const allMinutes = isFull(cron.minutes, 0, 59);

  if (everyDay && allHours) {
    if (allMinutes) return 'Every minute';
    const step = uniformStep(cron.minutes, 0, 59);
    if (step) return `Every ${step} minutes`;
    if (cron.minutes.size === 1) {
      const m = sorted(cron.minutes)[0];
      return m === 0 ? 'Every hour' : `Every hour at :${String(m).padStart(2, '0')}`;
    }
    return custom;
  }

  if (everyDay && cron.minutes.size === 1) {
    const hourStep = uniformStep(cron.hours, 0, 23);
    if (hourStep) {
      const m = sorted(cron.minutes)[0];
      return `Every ${hourStep} hours${m ? ` at :${String(m).padStart(2, '0')}` : ''}`;
    }
  }

  // A clock time (or a few) on some set of days.
  if (cron.minutes.size === 1 && cron.hours.size <= 4) {
    const days = describeDays(cron);
    if (!days) return custom;
    const m = sorted(cron.minutes)[0];
    const times = sorted(cron.hours).map((h) => formatClock(h, m));
    return `${days} at ${joinWords(times)}`;
  }

  return custom;
}
