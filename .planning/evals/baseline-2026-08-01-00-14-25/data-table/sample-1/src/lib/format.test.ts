import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDayCount,
  formatDueRelative,
} from './format.ts'

describe('formatCurrency', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatCurrency(1_267_000)).toBe('$12,670.00')
    expect(formatCurrency(12_050)).toBe('$120.50')
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('keeps cents exactly, with no float drift', () => {
    expect(formatCurrency(1)).toBe('$0.01')
    expect(formatCurrency(10)).toBe('$0.10')
    expect(formatCurrency(4_918_396_6)).toBe('$491,839.66')
  })
})

describe('formatCurrencyCompact', () => {
  it('abbreviates large amounts', () => {
    expect(formatCurrencyCompact(4_918_396_6)).toBe('$491.8K')
    expect(formatCurrencyCompact(130_308_239)).toBe('$1.3M')
  })
})

describe('formatDate', () => {
  it('uses an unambiguous day-month-year form', () => {
    // Never 01/08/2026, which reads as two different dates either side of the
    // Atlantic.
    expect(formatDate('2026-08-01')).toBe('01 Aug 2026')
    expect(formatDate('2026-12-25')).toBe('25 Dec 2026')
  })

  it('does not shift the date across timezones', () => {
    // A UTC-midnight value formatted in a negative-offset local zone would
    // render as the previous day if timeZone were not pinned.
    expect(formatDate('2026-01-01')).toBe('01 Jan 2026')
  })
})

describe('formatDayCount', () => {
  it('pluralises correctly', () => {
    expect(formatDayCount(1)).toBe('1 day')
    expect(formatDayCount(2)).toBe('2 days')
    expect(formatDayCount(0)).toBe('0 days')
    expect(formatDayCount(-1)).toBe('1 day')
  })
})

describe('formatDueRelative', () => {
  it('describes late, today and upcoming', () => {
    expect(formatDueRelative(42)).toBe('42 days late')
    expect(formatDueRelative(1)).toBe('1 day late')
    expect(formatDueRelative(0)).toBe('Due today')
    expect(formatDueRelative(-5)).toBe('In 5 days')
    expect(formatDueRelative(-1)).toBe('In 1 day')
  })
})

describe('formatCount', () => {
  it('pluralises and groups', () => {
    expect(formatCount(1, 'invoice')).toBe('1 invoice')
    expect(formatCount(28, 'invoice')).toBe('28 invoices')
    expect(formatCount(1200, 'invoice')).toBe('1,200 invoices')
  })

  it('accepts an irregular plural', () => {
    expect(formatCount(2, 'entry', 'entries')).toBe('2 entries')
  })
})
