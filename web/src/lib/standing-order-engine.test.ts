import { describe, it, expect } from 'vitest';
import { evaluateStandingOrders, hashSnapshot } from './standing-order-engine';
import type { StandingOrder } from '@/stores/assistant-store';

const NOW = new Date(2026, 6, 20, 9, 0, 0); // 2026-07-20 09:00 local (a Monday)

const order = (overrides: Partial<StandingOrder> = {}): StandingOrder => ({
  id: 'o1',
  instruction: 'do the thing',
  trigger: { type: 'interval', expression: '1h' },
  state: {},
  status: 'active',
  notifyVia: 'assistant',
  runCount: 0,
  errorCount: 0,
  createdAt: NOW.getTime() - 86_400_000,
  updatedAt: NOW.getTime() - 86_400_000,
  ...overrides,
});

describe('evaluateStandingOrders', () => {
  describe('gates', () => {
    it('skips non-active orders', () => {
      for (const status of ['paused', 'completed', 'expired'] as const) {
        expect(evaluateStandingOrders([order({ status })], NOW)).toEqual([]);
      }
    });

    it('skips expired orders', () => {
      expect(
        evaluateStandingOrders([order({ expiresAt: NOW.getTime() - 1 })], NOW),
      ).toEqual([]);
      expect(
        evaluateStandingOrders([order({ expiresAt: NOW.getTime() })], NOW),
      ).toEqual([]);
    });

    it('still fires before the expiry moment', () => {
      const o = order({ expiresAt: NOW.getTime() + 1 });
      expect(evaluateStandingOrders([o], NOW)).toEqual([o]);
    });

    it('skips orders that hit maxExecutions', () => {
      expect(
        evaluateStandingOrders([order({ maxExecutions: 3, runCount: 3 })], NOW),
      ).toEqual([]);
      const under = order({ maxExecutions: 3, runCount: 2 });
      expect(evaluateStandingOrders([under], NOW)).toEqual([under]);
    });
  });

  describe('cron triggers', () => {
    const cronOrder = (overrides: Partial<StandingOrder> = {}) =>
      order({ trigger: { type: 'cron', expression: '0 9 * * *' }, ...overrides });

    it('fires when the cron expression matches', () => {
      const o = cronOrder();
      expect(evaluateStandingOrders([o], NOW)).toEqual([o]);
    });

    it('does not fire when the cron expression does not match', () => {
      expect(evaluateStandingOrders([cronOrder()], new Date(2026, 6, 20, 9, 1))).toEqual([]);
    });

    it('does not double-fire within the same minute', () => {
      // NOW is 09:00:00 exactly; +30s is still minute 09:00, −10s is minute 08:59
      const sameMinute = cronOrder({ lastRun: NOW.getTime() + 30_000 });
      const previousMinute = cronOrder({ lastRun: NOW.getTime() - 10_000 });
      expect(evaluateStandingOrders([sameMinute], NOW)).toEqual([]);
      expect(evaluateStandingOrders([previousMinute], NOW)).toEqual([previousMinute]);
    });

    it('does not fire cron triggers missing an expression', () => {
      expect(
        evaluateStandingOrders([order({ trigger: { type: 'cron' } })], NOW),
      ).toEqual([]);
    });
  });

  describe('interval triggers', () => {
    it('fires immediately when never run', () => {
      const o = order({ trigger: { type: 'interval', expression: '5m' } });
      expect(evaluateStandingOrders([o], NOW)).toEqual([o]);
    });

    it('fires only after the interval has elapsed', () => {
      const due = order({
        trigger: { type: 'interval', expression: '5m' },
        lastRun: NOW.getTime() - 5 * 60_000,
      });
      const notDue = order({
        trigger: { type: 'interval', expression: '5m' },
        lastRun: NOW.getTime() - 4 * 60_000,
      });
      expect(evaluateStandingOrders([due, notDue], NOW)).toEqual([due]);
    });

    it('understands s/min/h/hr/d unit spellings', () => {
      const mk = (expression: string, elapsedMs: number) =>
        order({ trigger: { type: 'interval', expression }, lastRun: NOW.getTime() - elapsedMs });

      expect(evaluateStandingOrders([mk('30s', 30_000)], NOW)).toHaveLength(1);
      expect(evaluateStandingOrders([mk('30 secs', 30_000)], NOW)).toHaveLength(1);
      expect(evaluateStandingOrders([mk('2min', 2 * 60_000)], NOW)).toHaveLength(1);
      expect(evaluateStandingOrders([mk('1hr', 3_600_000)], NOW)).toHaveLength(1);
      expect(evaluateStandingOrders([mk('1d', 86_400_000)], NOW)).toHaveLength(1);
      expect(evaluateStandingOrders([mk('2 days', 86_400_000)], NOW)).toHaveLength(0);
    });

    it('never fires on malformed interval expressions', () => {
      const o = order({ trigger: { type: 'interval', expression: 'whenever' } });
      expect(evaluateStandingOrders([o], NOW)).toEqual([]);
    });
  });

  it('never fires event triggers (handled externally)', () => {
    const o = order({ trigger: { type: 'event', event: 'webhook' } });
    expect(evaluateStandingOrders([o], NOW)).toEqual([]);
  });
});

describe('hashSnapshot', () => {
  it('is deterministic', () => {
    expect(hashSnapshot('hello world')).toBe(hashSnapshot('hello world'));
  });

  it('differs for different content', () => {
    expect(hashSnapshot('snapshot A')).not.toBe(hashSnapshot('snapshot B'));
  });

  it('handles empty input', () => {
    expect(hashSnapshot('')).toBe('0');
  });
});
