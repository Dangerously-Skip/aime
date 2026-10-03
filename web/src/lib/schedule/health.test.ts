import { describe, it, expect } from 'vitest';
import { scheduleHealth, expectedRunAt, type HealthOrder } from './health';

const NOW = new Date(2026, 6, 20, 12, 0).getTime();
const HOUR = 3_600_000;

const order = (over: Partial<HealthOrder> = {}): HealthOrder => ({
  id: 'o1',
  instruction: 'Check the build',
  trigger: { type: 'interval', expression: '1h' },
  status: 'active',
  createdAt: NOW - 10 * HOUR,
  lastRun: NOW - 30 * 60_000,
  errorCount: 0,
  runCount: 5,
  ...over,
});

describe('scheduleHealth', () => {
  it('is empty when everything is fine — so the panel takes no space', () => {
    expect(scheduleHealth({ orders: [order()], now: NOW })).toEqual([]);
  });

  it('flags a schedule whose latest event is an error', () => {
    const items = scheduleHealth({
      orders: [order()],
      activity: [
        { orderId: 'o1', type: 'order-fired', label: 'ok', timestamp: NOW - 2 * HOUR },
        { orderId: 'o1', type: 'order-error', label: 'Error: upstream 502', timestamp: NOW - HOUR },
      ],
      now: NOW,
    });
    expect(items).toEqual([expect.objectContaining({ kind: 'failed', orderId: 'o1', detail: 'Error: upstream 502' })]);
  });

  it('does not flag an old error once a later run succeeded', () => {
    const items = scheduleHealth({
      orders: [order()],
      activity: [
        { orderId: 'o1', type: 'order-error', label: 'Error', timestamp: NOW - 2 * HOUR },
        { orderId: 'o1', type: 'order-fired', label: 'ok', timestamp: NOW - HOUR },
      ],
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it('flags an order paused by errors, and an unreadable schedule', () => {
    const items = scheduleHealth({
      orders: [
        order({ id: 'p', status: 'paused', errorCount: 3 }),
        order({ id: 'bad', trigger: { type: 'cron', expression: '0 9 * * FUNDAY' } }),
        // A user pause is not a problem.
        order({ id: 'user', status: 'paused', errorCount: 0 }),
      ],
      now: NOW,
    });
    expect(items.map((i) => [i.kind, i.orderId])).toEqual([['paused', 'p'], ['invalid', 'bad']]);
  });

  it('flags an overdue run, and says an attended job needs the app open', () => {
    const items = scheduleHealth({
      orders: [
        order({ id: 'late', lastRun: NOW - 3 * HOUR }),
        order({ id: 'job', attended: true, lastRun: NOW - 3 * HOUR }),
        // Within the grace window: not overdue yet.
        order({ id: 'fine', lastRun: NOW - HOUR - 60_000 }),
      ],
      now: NOW,
      appName: 'AIME',
    });
    expect(items.map((i) => i.key)).toEqual(['overdue:late', 'overdue:job']);
    expect(items[0].detail).toBe('Every hour — missed its run 2 hours ago');
    expect(items[1].detail).toMatch(/runs only while AIME is open/);
    // Attended jobs are edited elsewhere, so the row does not open the order editor.
    expect(items[1].orderId).toBeUndefined();
  });

  it('counts failed runs in the last day', () => {
    const items = scheduleHealth({
      orders: [],
      runs: [
        { status: 'failed', startedAt: NOW - HOUR },
        { status: 'timeout', startedAt: NOW - 2 * HOUR },
        { status: 'failed', startedAt: NOW - 30 * HOUR },
        { status: 'succeeded', startedAt: NOW - HOUR },
      ],
      now: NOW,
    });
    expect(items).toEqual([expect.objectContaining({ kind: 'failed-runs', title: '2 runs failed in the last 24 hours' })]);
  });
});

describe('expectedRunAt', () => {
  it('uses the next cron match after the last run', () => {
    const at = expectedRunAt(order({ trigger: { type: 'cron', expression: '0 9 * * *' }, lastRun: new Date(2026, 6, 19, 9, 0).getTime() }));
    expect(at).toBe(new Date(2026, 6, 20, 9, 0).getTime());
  });

  it('is null for a finished, paused or event-driven job', () => {
    expect(expectedRunAt(order({ status: 'paused' }))).toBeNull();
    expect(expectedRunAt(order({ maxExecutions: 5, runCount: 5 }))).toBeNull();
    expect(expectedRunAt(order({ trigger: { type: 'event', event: 'x' } }))).toBeNull();
  });
});

/*
 * A standing order that "succeeded" with half its job refused is the quiet
 * failure this list exists for: refused, not paused, so nothing will finish it.
 */
describe('scheduleHealth — refused steps', () => {
  const refused = (tools: string[], startedAt = NOW - HOUR) => ({
    status: 'succeeded',
    startedAt,
    goalId: 'so:o1',
    refusals: tools.map((tool) => ({ tool })),
  });

  it("flags an order whose last run had steps refused, naming the tools", () => {
    const items = scheduleHealth({ orders: [order()], runs: [refused(['Write', 'Bash', 'Write'])], now: NOW });
    expect(items).toEqual([
      expect.objectContaining({ kind: 'refused', orderId: 'o1', detail: expect.stringMatching(/3 steps refused \(Write, Bash\)/) }),
    ]);
  });

  it('clears once a later run had none — as a success clears a failure', () => {
    const items = scheduleHealth({
      orders: [order()],
      runs: [refused(['Write'], NOW - 2 * HOUR), { status: 'succeeded', startedAt: NOW - HOUR, goalId: 'so:o1' }],
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it("ignores another goal's refusals", () => {
    const items = scheduleHealth({ orders: [order()], runs: [{ ...refused(['Write']), goalId: 'so:other' }], now: NOW });
    expect(items).toEqual([]);
  });
});
