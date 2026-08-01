import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, parseIsoDate, todayIsoDate, toIsoDate } from './dates.ts'

describe('parseIsoDate', () => {
  it('anchors to UTC midnight', () => {
    expect(parseIsoDate('2026-08-01')).toBe(Date.UTC(2026, 7, 1))
  })

  it('rejects malformed input', () => {
    expect(() => parseIsoDate('01/08/2026')).toThrow(TypeError)
    expect(() => parseIsoDate('2026-8-1')).toThrow(TypeError)
    expect(() => parseIsoDate('')).toThrow(TypeError)
  })

  it('rejects dates that do not exist rather than rolling them forward', () => {
    // Date.UTC would happily read this as 2026-03-02.
    expect(() => parseIsoDate('2026-02-30')).toThrow(RangeError)
    expect(() => parseIsoDate('2026-13-01')).toThrow(RangeError)
  })

  it('accepts a real leap day and rejects a fake one', () => {
    expect(() => parseIsoDate('2024-02-29')).not.toThrow()
    expect(() => parseIsoDate('2026-02-29')).toThrow(RangeError)
  })
})

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2026-08-01', '2026-08-08')).toBe(7)
    expect(daysBetween('2026-08-08', '2026-08-01')).toBe(-7)
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0)
  })

  it('stays exact across a spring DST transition', () => {
    // In local time these 3 days span a 23-hour day; naive subtraction would
    // give 2.958 and floor to 2.
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3)
  })

  it('stays exact across an autumn DST transition', () => {
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3)
  })

  it('handles month and year boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2) // leap year
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
  })
})

describe('addDays', () => {
  it('shifts across month and year ends', () => {
    expect(addDays('2026-08-01', 31)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-08-01', 0)).toBe('2026-08-01')
  })

  it('round-trips with daysBetween', () => {
    const start = '2026-05-17'
    for (const offset of [-400, -90, -1, 0, 1, 45, 365]) {
      expect(daysBetween(start, addDays(start, offset))).toBe(offset)
    }
  })
})

describe('toIsoDate', () => {
  it('inverts parseIsoDate', () => {
    expect(toIsoDate(parseIsoDate('2026-08-01'))).toBe('2026-08-01')
  })
})

describe('todayIsoDate', () => {
  it('reads local calendar components, not the UTC instant', () => {
    // 1 Aug 2026, 00:30 local. In a negative-offset zone this is still
    // 31 July in UTC, but the user's calendar says 1 August.
    const localMidnightish = new Date(2026, 7, 1, 0, 30)
    expect(todayIsoDate(localMidnightish)).toBe('2026-08-01')
  })

  it('zero-pads single-digit months and days', () => {
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
