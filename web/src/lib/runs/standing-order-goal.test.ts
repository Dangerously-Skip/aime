import { describe, it, expect } from 'vitest';
import {
  parseIntervalSeconds,
  standingOrderToGoal,
  standingOrdersToGoals,
  type StandingOrderLike,
} from './standing-order-goal';

const order = (over: Partial<StandingOrderLike> = {}): StandingOrderLike => ({
  id: 'o1',
  instruction: 'Watch main for build failures and summarise them',
  trigger: { type: 'cron', expression: '0 9 * * *' },
  status: 'active',
  runCount: 0,
  errorCount: 0,
  createdAt: 1_000,
  ...over,
});

describe('parseIntervalSeconds', () => {
  it('reads the units standing orders actually use', () => {
    expect(parseIntervalSeconds('90')).toBe(90); // bare number ⇒ seconds
    expect(parseIntervalSeconds('45s')).toBe(45);
    expect(parseIntervalSeconds('30m')).toBe(1_800);
    expect(parseIntervalSeconds('30 minutes')).toBe(1_800);
    expect(parseIntervalSeconds('2h')).toBe(7_200);
    expect(parseIntervalSeconds('2 hours')).toBe(7_200);
    expect(parseIntervalSeconds('1d')).toBe(86_400);
    expect(parseIntervalSeconds('1.5h')).toBe(5_400);
  });

  // Guessing a schedule we can't read would fire the goal at the wrong time.
  it('returns null rather than guessing', () => {
    expect(parseIntervalSeconds(undefined)).toBeNull();
    expect(parseIntervalSeconds('')).toBeNull();
    expect(parseIntervalSeconds('whenever')).toBeNull();
    expect(parseIntervalSeconds('0')).toBeNull();
    expect(parseIntervalSeconds('-5m')).toBeNull();
    expect(parseIntervalSeconds('1 month')).toBeNull(); // 'mo' is not minutes
  });
});

describe('standingOrderToGoal', () => {
  it('maps the core fields', () => {
    const g = standingOrderToGoal(
      order({ completionCondition: 'a summary was posted', condition: 'only on weekdays', lastRun: 5_000 }),
    );
    expect(g).toMatchObject({
      id: 'so:o1',
      sourceId: 'o1',
      objective: 'Watch main for build failures and summarise them',
      constraints: 'only on weekdays',
      enabled: true,
      createdAt: 1_000,
      lastRunAt: 5_000,
      approvalPolicy: 'consequential',
    });
    // A completion condition is a STOP-condition, not a per-run success
    // criterion — mapping it to successCriteria would make every watch-type
    // order read as failing nightly until the day it completes.
    expect(g.successCriteria).toBeUndefined();
  });

  it('carries a cron schedule through verbatim', () => {
    expect(standingOrderToGoal(order()).schedule).toEqual({ cron: '0 9 * * *' });
  });

  it('converts an interval schedule to seconds', () => {
    const g = standingOrderToGoal(order({ trigger: { type: 'interval', expression: '30m' } }));
    expect(g.schedule).toEqual({ everySeconds: 1_800 });
  });

  it('leaves the schedule undefined for event triggers and unparseable intervals', () => {
    expect(standingOrderToGoal(order({ trigger: { type: 'event', event: 'push' } })).schedule).toBeUndefined();
    expect(
      standingOrderToGoal(order({ trigger: { type: 'interval', expression: 'sometimes' } })).schedule,
    ).toBeUndefined();
  });

  it('only an active order is enabled', () => {
    for (const status of ['paused', 'completed', 'expired'] as const) {
      expect(standingOrderToGoal(order({ status })).enabled).toBe(false);
    }
    expect(standingOrderToGoal(order({ status: 'active' })).enabled).toBe(true);
  });

  // The trap this adapter exists to avoid: errorCount is a lifetime total, not a
  // streak. Mapping it onto consecutiveFailures would render an order with 40
  // successes and 1 old failure as "currently failing".
  it('does NOT turn a lifetime error count into a failure streak', () => {
    const g = standingOrderToGoal(order({ runCount: 41, errorCount: 1 }));
    expect(g.consecutiveFailures).toBeUndefined();
    expect(g.prior).toEqual({ runCount: 41, errorCount: 1, totalUsd: undefined });
  });

  it('carries historical totals as context, not as live data', () => {
    const g = standingOrderToGoal(order({ runCount: 12, errorCount: 2, totalCost: 0.42 }));
    expect(g.prior).toEqual({ runCount: 12, errorCount: 2, totalUsd: 0.42 });
  });

  it('omits prior entirely for an order that has never run', () => {
    expect(standingOrderToGoal(order()).prior).toBeUndefined();
  });
});

describe('standingOrdersToGoals', () => {
  it('adapts a list and skips instruction-less orders', () => {
    const goals = standingOrdersToGoals([
      order({ id: 'a' }),
      order({ id: 'blank', instruction: '   ' }),
      order({ id: 'b' }),
    ]);
    expect(goals.map((g) => g.sourceId)).toEqual(['a', 'b']);
  });

  it('produces stable ids so runs stay attributed across reloads', () => {
    const first = standingOrdersToGoals([order()]);
    const second = standingOrdersToGoals([order({ lastRun: 999 })]);
    expect(first[0].id).toBe(second[0].id);
  });
});
