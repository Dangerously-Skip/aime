import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  specToTrigger,
  triggerToSpec,
  validateSpec,
  validateTrigger,
  describeTrigger,
  nextRunForTrigger,
  formatNextRun,
  type ScheduleSpec,
} from './schedule';
import { isJobDue } from './due';

const MON_9AM = new Date(2026, 6, 20, 9, 0).getTime();

describe('spec ⇄ trigger', () => {
  it.each<[ScheduleSpec, { type: string; expression: string }]>([
    [{ kind: 'every-minutes', every: 90 }, { type: 'interval', expression: '90m' }],
    [{ kind: 'every-hours', every: 2 }, { type: 'interval', expression: '2h' }],
    [{ kind: 'daily', time: '09:00' }, { type: 'cron', expression: '0 9 * * *' }],
    [{ kind: 'weekdays', time: '17:30' }, { type: 'cron', expression: '30 17 * * 1-5' }],
    [{ kind: 'weekly', day: 1, time: '08:05' }, { type: 'cron', expression: '5 8 * * 1' }],
    [{ kind: 'custom', expression: '*/10 9-17 * * MON-FRI' }, { type: 'cron', expression: '*/10 9-17 * * MON-FRI' }],
    // An interval typed into Custom is normalised to the canonical spelling.
    [{ kind: 'custom', expression: '1.5 hours' }, { type: 'interval', expression: '90m' }],
  ])('%j → %j', (spec, trigger) => {
    expect(specToTrigger(spec)).toEqual(trigger);
  });

  it('opens a stored trigger on its friendliest preset', () => {
    expect(triggerToSpec({ type: 'cron', expression: '0 9 * * 1-5' })).toEqual({ kind: 'weekdays', time: '09:00' });
    expect(triggerToSpec({ type: 'cron', expression: '0 9 * * MON-FRI' })).toEqual({ kind: 'weekdays', time: '09:00' });
    expect(triggerToSpec({ type: 'cron', expression: '0 9 * * 7' })).toEqual({ kind: 'weekly', day: 0, time: '09:00' });
    expect(triggerToSpec({ type: 'interval', expression: '2h' })).toEqual({ kind: 'every-hours', every: 2 });
    expect(triggerToSpec({ type: 'interval', expression: '1.5h' })).toEqual({ kind: 'every-minutes', every: 90 });
    expect(triggerToSpec({ type: 'interval', expression: '30s' })).toEqual({ kind: 'custom', expression: '30s' });
    expect(triggerToSpec({ type: 'cron', expression: '0 9 1 * *' })).toEqual({ kind: 'custom', expression: '0 9 1 * *' });
  });

  it('round-trips every valid preset (property)', () => {
    const time = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
      .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    const spec: fc.Arbitrary<ScheduleSpec> = fc.oneof(
      fc.integer({ min: 1, max: 1440 }).filter((n) => n % 60 !== 0).map((every) => ({ kind: 'every-minutes' as const, every })),
      fc.integer({ min: 1, max: 168 }).map((every) => ({ kind: 'every-hours' as const, every })),
      time.map((t) => ({ kind: 'daily' as const, time: t })),
      time.map((t) => ({ kind: 'weekdays' as const, time: t })),
      fc.tuple(fc.integer({ min: 0, max: 6 }), time).map(([day, t]) => ({ kind: 'weekly' as const, day, time: t })),
    );
    fc.assert(fc.property(spec, (s) => {
      const trigger = specToTrigger(s);
      return validateTrigger(trigger) === null && JSON.stringify(triggerToSpec(trigger)) === JSON.stringify(s);
    }));
  });
});

describe('validation at save time', () => {
  it('rejects presets that cannot be run', () => {
    expect(validateSpec({ kind: 'every-minutes', every: 0 })).toMatch(/1 to 1440/);
    expect(validateSpec({ kind: 'every-hours', every: 1.5 })).toMatch(/whole number/);
    expect(validateSpec({ kind: 'daily', time: '25:00' })).toMatch(/time/);
    expect(validateSpec({ kind: 'weekly', day: 9, time: '09:00' })).toMatch(/day/);
    expect(validateSpec({ kind: 'custom', expression: '0 9 * * FUNDAY' })).toMatch(/day of week/);
    expect(validateSpec({ kind: 'custom', expression: '' })).toBeTruthy();
  });

  it('accepts what it can run', () => {
    expect(validateSpec({ kind: 'custom', expression: '90 minutes' })).toBeNull();
    expect(validateSpec({ kind: 'weekdays', time: '09:00' })).toBeNull();
  });

  it('validates triggers of every type', () => {
    expect(validateTrigger({ type: 'interval', expression: 'soon' })).toMatch(/not an interval/);
    expect(validateTrigger({ type: 'cron', expression: '0 9 * *' })).toMatch(/5 fields/);
    expect(validateTrigger({ type: 'event', event: '' })).toMatch(/event/);
    expect(validateTrigger({ type: 'event', event: 'build-failed' })).toBeNull();
  });
});

describe('describeTrigger', () => {
  it('says it the way a person would', () => {
    expect(describeTrigger({ type: 'interval', expression: '1.5h' })).toBe('Every 90 minutes');
    expect(describeTrigger({ type: 'cron', expression: '0 9 * * 1-5' })).toBe('Weekdays at 9:00 AM');
    expect(describeTrigger({ type: 'event', event: 'build-failed' })).toBe('On build-failed');
    expect(describeTrigger({ type: 'interval', expression: 'soon' })).toBe('Invalid schedule (soon)');
  });
});

describe('nextRunForTrigger mirrors isJobDue', () => {
  it('counts a never-run interval from creation', () => {
    const next = nextRunForTrigger({ type: 'interval', expression: '5m' }, { status: 'active', createdAt: MON_9AM }, MON_9AM);
    expect(next).toBe(MON_9AM + 5 * 60_000);
  });

  it('is the next matching minute for cron', () => {
    const next = nextRunForTrigger({ type: 'cron', expression: '0 9 * * 1-5' }, { status: 'active' }, MON_9AM);
    expect(next).toBe(new Date(2026, 6, 21, 9, 0).getTime());
  });

  it('is null when paused, exhausted, expired, invalid or event-driven', () => {
    const t = { type: 'interval' as const, expression: '5m' };
    expect(nextRunForTrigger(t, { status: 'paused' }, MON_9AM)).toBeNull();
    expect(nextRunForTrigger(t, { status: 'active', runCount: 1, maxExecutions: 1 }, MON_9AM)).toBeNull();
    expect(nextRunForTrigger(t, { status: 'active', createdAt: MON_9AM, expiresAt: MON_9AM + 60_000 }, MON_9AM)).toBeNull();
    expect(nextRunForTrigger({ type: 'interval', expression: 'soon' }, {}, MON_9AM)).toBeNull();
    expect(nextRunForTrigger({ type: 'event', event: 'x' }, {}, MON_9AM)).toBeNull();
  });

  it('never promises a run the ticker would not make (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('1m', '5m', '90 minutes', '1.5h', '2h'),
        fc.integer({ min: 0, max: 10_000_000 }),
        (expression, age) => {
          const createdAt = MON_9AM - age;
          const trigger = { type: 'interval' as const, expression };
          const next = nextRunForTrigger(trigger, { status: 'active', createdAt }, MON_9AM)!;
          const job = { status: 'active', trigger, createdAt, runCount: 0 };
          // Due at the promised time, and not a minute before it (unless overdue).
          return isJobDue(job, next) && (next === MON_9AM || !isJobDue(job, next - 60_000));
        },
      ),
    );
  });
});

describe('formatNextRun', () => {
  it('uses Today / Tomorrow, then a date', () => {
    expect(formatNextRun(MON_9AM + 3_600_000, MON_9AM)).toBe('Today 10:00 AM');
    expect(formatNextRun(MON_9AM + 86_400_000, MON_9AM)).toBe('Tomorrow 9:00 AM');
    expect(formatNextRun(new Date(2026, 6, 24, 9, 0).getTime(), MON_9AM)).toBe('Fri 24 Jul, 9:00 AM');
  });
});
