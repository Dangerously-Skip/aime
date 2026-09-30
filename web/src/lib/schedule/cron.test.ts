import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseCron, validateCron, matchesCron, nextCronRun, describeCron, formatClock } from './cron';

/** Local-time date; 2026-07-20 is a Monday. */
const at = (day: number, h: number, m: number, month = 6) => new Date(2026, month, day, h, m);

describe('names and 7 = Sunday — accepted on save, so they must match', () => {
  /*
   * The bug: `0 9 * * MON-FRI` passed the field-count check and then matched
   * nothing, forever (`Number('MON')` is NaN); `7` never matched either because
   * `getDay()` has no 7. Both looked scheduled and silently never ran.
   */
  it('matches day names in ranges and lists', () => {
    expect(matchesCron('0 9 * * MON-FRI', at(20, 9, 0))).toBe(true); // Monday
    expect(matchesCron('0 9 * * mon-fri', at(24, 9, 0))).toBe(true); // Friday
    expect(matchesCron('0 9 * * MON-FRI', at(25, 9, 0))).toBe(false); // Saturday
    expect(matchesCron('0 9 * * SAT,SUN', at(26, 9, 0))).toBe(true);
  });

  it('treats 7 as Sunday, like 0', () => {
    expect(matchesCron('0 9 * * 7', at(26, 9, 0))).toBe(true); // Sunday 26 July
    expect(matchesCron('0 9 * * 0', at(26, 9, 0))).toBe(true);
    expect(matchesCron('0 9 * * 5-7', at(26, 9, 0))).toBe(true);
    expect(matchesCron('0 9 * * 7', at(20, 9, 0))).toBe(false);
  });

  it('matches month names', () => {
    expect(matchesCron('0 0 20 JUL *', at(20, 0, 0))).toBe(true);
    expect(matchesCron('0 0 20 aug *', at(20, 0, 0))).toBe(false);
  });

  it('expands macros', () => {
    expect(matchesCron('@daily', at(20, 0, 0))).toBe(true);
    expect(matchesCron('@hourly', at(20, 7, 0))).toBe(true);
    expect(matchesCron('@weekly', at(26, 0, 0))).toBe(true);
  });
});

describe('field semantics', () => {
  it('counts a wildcard step from the field minimum (day-of-month starts at 1)', () => {
    expect(matchesCron('0 0 */2 * *', at(1, 0, 0))).toBe(true);
    expect(matchesCron('0 0 */2 * *', at(2, 0, 0))).toBe(false);
  });

  it('reads a/n as a-max/n', () => {
    expect(matchesCron('5/20 * * * *', at(20, 10, 45))).toBe(true);
    expect(matchesCron('5/20 * * * *', at(20, 10, 0))).toBe(false);
  });

  it('ORs day-of-month and day-of-week when both are restricted (Vixie cron)', () => {
    // The 1st of the month OR any Monday.
    expect(matchesCron('0 9 1 * MON', at(20, 9, 0))).toBe(true); // Monday 20th
    expect(matchesCron('0 9 1 * MON', at(1, 9, 0))).toBe(true); // Wednesday 1st
    expect(matchesCron('0 9 1 * MON', at(21, 9, 0))).toBe(false);
  });
});

describe('validateCron — a reason, not a silent never-run', () => {
  it.each([
    ['0 9 * *', /5 fields/],
    ['60 * * * *', /minute must be between 0 and 59/],
    ['0 24 * * *', /hour/],
    ['0 9 0 * *', /day of month/],
    ['0 9 * 13 *', /month/],
    ['0 9 * * 8', /day of week/],
    ['0 9 * * FUNDAY', /not a valid day of week/],
    ['*/0 * * * *', /step/],
    ['*/x * * * *', /step/],
    ['0 17-9 * * *', /backwards/],
    ['1,,2 * * * *', /empty/],
  ])('%s', (expr, reason) => {
    expect(validateCron(expr)).toMatch(reason);
    expect(matchesCron(expr, at(20, 9, 0))).toBe(false);
  });

  it('accepts ordinary expressions', () => {
    for (const ok of ['* * * * *', '0 9 * * 1-5', '*/15 9-17 * * MON-FRI', '0 0 1 JAN *', '@monthly']) {
      expect(validateCron(ok), ok).toBeNull();
    }
  });

  it('treats prototype names as text, not as table entries', () => {
    // Found by the StandingOrderCreate property test: `__proto__` threw
    // ("expanded.split is not a function") and a field named `constructor`
    // resolved to a function.
    for (const s of ['__proto__', 'constructor', 'toString', '0 9 * constructor *', '0 9 * * __proto__', 'hasOwnProperty 9 * * *']) {
      expect(() => parseCron(s), s).not.toThrow();
      expect(validateCron(s), s).not.toBeNull();
    }
  });

  it('never throws on any input (property)', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const r = parseCron(s);
      return r.ok || (typeof r.error === 'string' && r.error.length > 0);
    }));
  });
});

describe('nextCronRun', () => {
  it('finds the next weekday morning from a Friday afternoon', () => {
    const next = nextCronRun('0 9 * * 1-5', at(24, 15, 0));
    expect(next).toEqual(at(27, 9, 0));
  });

  it('is strictly after `from`, never the current minute', () => {
    expect(nextCronRun('* * * * *', at(20, 9, 0))).toEqual(at(20, 9, 1));
  });

  it('crosses a year boundary', () => {
    expect(nextCronRun('0 0 1 JAN *', new Date(2026, 6, 20))).toEqual(new Date(2027, 0, 1, 0, 0));
  });

  it('is null for a schedule that can never happen, and for garbage', () => {
    expect(nextCronRun('0 0 30 2 *', at(20, 9, 0))).toBeNull();
    expect(nextCronRun('nope', at(20, 9, 0))).toBeNull();
  });

  it('always returns a minute that matches (property)', () => {
    const exprs = ['*/7 * * * *', '0 9 * * 1-5', '30 */3 * * *', '0 12 1,15 * *', '15 8 * * SAT', '0 0 1 * MON'];
    fc.assert(
      fc.property(
        fc.constantFrom(...exprs),
        fc.integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2030, 0, 1) }),
        (expr, fromMs) => {
          const next = nextCronRun(expr, new Date(fromMs));
          return next !== null && next.getTime() > fromMs && matchesCron(expr, next);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('describeCron', () => {
  it.each([
    ['* * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 * * * *', 'Every hour'],
    ['5 * * * *', 'Every hour at :05'],
    ['0 */2 * * *', 'Every 2 hours'],
    ['0 9 * * *', 'Every day at 9:00 AM'],
    ['30 17 * * 1-5', 'Weekdays at 5:30 PM'],
    ['0 9 * * MON-FRI', 'Weekdays at 9:00 AM'],
    ['0 10 * * 0,6', 'Weekends at 10:00 AM'],
    ['0 9 * * 1', 'Every Monday at 9:00 AM'],
    ['0 9 * * 7', 'Every Sunday at 9:00 AM'],
    ['0 9 * * 1,3,5', 'Every Mon, Wed and Fri at 9:00 AM'],
    ['0 9,17 * * *', 'Every day at 9:00 AM and 5:00 PM'],
    ['0 0 1 * *', 'Monthly on day 1 at 12:00 AM'],
    ['0 9 * 3 *', 'Custom schedule (0 9 * 3 *)'],
  ])('%s → %s', (expr, words) => {
    expect(describeCron(expr)).toBe(words);
  });

  it('is null for an expression that does not parse', () => {
    expect(describeCron('0 9 * *')).toBeNull();
  });

  it('formats clock times without locale drift', () => {
    expect(formatClock(0, 0)).toBe('12:00 AM');
    expect(formatClock(12, 5)).toBe('12:05 PM');
    expect(formatClock(23, 59)).toBe('11:59 PM');
  });
});
