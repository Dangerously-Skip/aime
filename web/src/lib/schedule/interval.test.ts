import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import { parseIntervalMs, canonicalInterval, describeIntervalMs, MIN_INTERVAL_MS } from './interval';
import { parseIntervalSeconds } from '@/lib/runs/standing-order-goal';
import { isJobDue } from './due';

describe('parseIntervalMs', () => {
  it.each([
    ['30s', 30_000], ['30 sec', 30_000], ['30secs', 30_000], ['45 seconds', 45_000],
    ['5m', 300_000], ['5min', 300_000], ['5 mins', 300_000], ['90 minutes', 5_400_000],
    ['2h', 7_200_000], ['2hr', 7_200_000], ['2 hrs', 7_200_000], ['2 hours', 7_200_000],
    ['1.5h', 5_400_000], ['1h 30m', 5_400_000], ['1h, 30m', 5_400_000], ['1 hour and 30 minutes', 5_400_000],
    ['1d', 86_400_000], ['1day', 86_400_000], ['2 days', 172_800_000], ['1w', 604_800_000],
    ['every 2 hours', 7_200_000], ['  5M  ', 300_000],
  ])('%s → %ims', (expr, ms) => {
    expect(parseIntervalMs(expr)).toBe(ms);
  });

  it('refuses what it cannot read rather than guessing a number', () => {
    for (const bad of [
      '', '   ', 'soon', '5', '90', 'm5', '-5m', '0m', '0.1s', '1 month', '5 mo', '5mx', 'every', '5m 5',
    ]) {
      expect(parseIntervalMs(bad), bad).toBeNull();
    }
    expect(parseIntervalMs(undefined)).toBeNull();
    expect(parseIntervalMs(null)).toBeNull();
  });

  it('never throws and never returns a non-positive or fractional number (property)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const ms = parseIntervalMs(s);
        return ms === null || (Number.isInteger(ms) && ms >= MIN_INTERVAL_MS);
      }),
    );
  });

  it('round-trips the canonical spelling for any whole-second interval (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), (seconds) => {
        const ms = seconds * 1_000;
        return parseIntervalMs(canonicalInterval(ms)) === ms;
      }),
    );
  });

  it('reads every value/unit pairing the same whatever the spelling (property)', () => {
    const spellings: Record<string, string[]> = {
      60_000: ['m', 'min', 'mins', 'minute', 'minutes'],
      3_600_000: ['h', 'hr', 'hrs', 'hour', 'hours'],
      86_400_000: ['d', 'day', 'days'],
    };
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.constantFrom(...Object.keys(spellings)),
        fc.nat(),
        fc.constantFrom('', ' '),
        (n, unitMs, pick, gap) => {
          const words = spellings[unitMs];
          return parseIntervalMs(`${n}${gap}${words[pick % words.length]}`) === n * Number(unitMs);
        },
      ),
    );
  });
});

describe('canonicalInterval / describeIntervalMs', () => {
  it('picks the largest unit that divides evenly', () => {
    expect(canonicalInterval(5_400_000)).toBe('90m');
    expect(canonicalInterval(7_200_000)).toBe('2h');
    expect(canonicalInterval(86_400_000)).toBe('1d');
    expect(canonicalInterval(30_000)).toBe('30s');
  });

  it('says it in words', () => {
    expect(describeIntervalMs(5_400_000)).toBe('Every 90 minutes');
    expect(describeIntervalMs(3_600_000)).toBe('Every hour');
    expect(describeIntervalMs(172_800_000)).toBe('Every 2 days');
  });
});

describe('ONE parser: the Cockpit and the tickers agree', () => {
  /*
   * The bug: "90 minutes" and "1.5h" had a next run in the Cockpit (its own
   * parser accepted them) and never fired (the tickers' parser did not).
   */
  it.each(['90 minutes', '1.5h', '1h 30m', '5m', 'soon', '90'])('%s', (expr) => {
    const cockpitSeconds = parseIntervalSeconds(expr);
    const fires = isJobDue(
      { status: 'active', trigger: { type: 'interval', expression: expr }, runCount: 0, lastRun: 1 },
      1 + 10 * 86_400_000,
    );
    expect(cockpitSeconds !== null).toBe(fires);
  });

  it('no module keeps a private interval regex any more', () => {
    const root = path.join(process.cwd(), 'src/lib');
    for (const rel of ['standing-order-engine.ts', 'orders/scheduler-pass.ts', 'runs/standing-order-goal.ts', 'schedule/due.ts']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src, rel).not.toMatch(/s\|sec\|m\|min/);
      expect(src, rel).not.toMatch(/startsWith\('mo'\)/);
    }
  });
});
