import { describe, it, expect } from 'vitest';
import { matchesCron } from './due';

/** Build a local Date: 2026-07-20 is a Monday. */
const at = (hour: number, minute: number, opts: { dom?: number; month?: number } = {}) =>
  new Date(2026, (opts.month ?? 7) - 1, opts.dom ?? 20, hour, minute, 0);

describe('matchesCron', () => {
  it('matches all-wildcard expression at any time', () => {
    expect(matchesCron('* * * * *', at(13, 37))).toBe(true);
  });

  it('matches exact minute and hour', () => {
    expect(matchesCron('0 9 * * *', at(9, 0))).toBe(true);
    expect(matchesCron('0 9 * * *', at(9, 1))).toBe(false);
    expect(matchesCron('0 9 * * *', at(10, 0))).toBe(false);
  });

  it('matches day-of-week (0 = Sunday)', () => {
    // 2026-07-20 is a Monday (dow 1)
    expect(matchesCron('0 9 * * 1', at(9, 0))).toBe(true);
    expect(matchesCron('0 9 * * 0', at(9, 0))).toBe(false);
  });

  it('matches day-of-month and month (1-based month)', () => {
    expect(matchesCron('0 0 20 7 *', at(0, 0))).toBe(true);
    expect(matchesCron('0 0 21 7 *', at(0, 0))).toBe(false);
    expect(matchesCron('0 0 20 8 *', at(0, 0))).toBe(false);
  });

  it('matches comma-separated lists', () => {
    expect(matchesCron('0,30 * * * *', at(12, 30))).toBe(true);
    expect(matchesCron('0,30 * * * *', at(12, 15))).toBe(false);
  });

  it('matches ranges', () => {
    expect(matchesCron('* 9-17 * * *', at(9, 0))).toBe(true);
    expect(matchesCron('* 9-17 * * *', at(17, 59))).toBe(true);
    expect(matchesCron('* 9-17 * * *', at(18, 0))).toBe(false);
  });

  it('matches step values with wildcard base', () => {
    expect(matchesCron('*/15 * * * *', at(10, 0))).toBe(true);
    expect(matchesCron('*/15 * * * *', at(10, 45))).toBe(true);
    expect(matchesCron('*/15 * * * *', at(10, 20))).toBe(false);
  });

  it('matches step values with a range base', () => {
    expect(matchesCron('10-30/10 * * * *', at(10, 20))).toBe(true);
    expect(matchesCron('10-30/10 * * * *', at(10, 25))).toBe(false);
    expect(matchesCron('10-30/10 * * * *', at(10, 40))).toBe(false);
  });

  it('combines lists with ranges', () => {
    expect(matchesCron('0-5,30 * * * *', at(11, 3))).toBe(true);
    expect(matchesCron('0-5,30 * * * *', at(11, 30))).toBe(true);
    expect(matchesCron('0-5,30 * * * *', at(11, 29))).toBe(false);
  });

  it('rejects expressions without exactly 5 fields', () => {
    expect(matchesCron('* * * *', at(9, 0))).toBe(false);
    expect(matchesCron('* * * * * *', at(9, 0))).toBe(false);
    expect(matchesCron('', at(9, 0))).toBe(false);
  });

  it('rejects invalid step values', () => {
    expect(matchesCron('*/x * * * *', at(10, 0))).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(matchesCron('  0 9 * * *  ', at(9, 0))).toBe(true);
  });
});
