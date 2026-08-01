/**
 * Display formatting.
 *
 * Formatters are module-level constants because `new Intl.NumberFormat(...)` is
 * surprisingly expensive — constructing one per cell would mean 1,200 of them
 * per render of a 200-row table. Built once, reused for every row.
 */

import { parseIsoDate } from '../domain/dates.ts'
import type { IsoDate } from '../domain/invoice.ts'

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const CURRENCY_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const DATE_LONG = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Money, always to two decimal places.
 *
 * Fixed decimals are what let the column align on the decimal point, which is
 * the whole reason a right-aligned money column is scannable. Dropping `.00`
 * for whole amounts would ragged the edge and defeat that.
 */
export function formatCurrency(cents: number): string {
  return CURRENCY.format(cents / 100)
}

/** Abbreviated money for the summary tiles, e.g. `$491.8K`. */
export function formatCurrencyCompact(cents: number): string {
  return CURRENCY_COMPACT.format(cents / 100)
}

/**
 * `01 Aug 2026`.
 *
 * Deliberately not a numeric format: `01/08/2026` is 1 August to a British
 * reader and 8 January to an American one, and an invoice table is exactly
 * where that ambiguity turns into a missed payment. The UTC timeZone matches
 * the calendar-date arithmetic in `domain/dates.ts`.
 */
export function formatDate(date: IsoDate): string {
  return DATE.format(parseIsoDate(date))
}

/** `1 August 2026`, for tooltips and screen-reader text. */
export function formatDateLong(date: IsoDate): string {
  return DATE_LONG.format(parseIsoDate(date))
}

/** `1 day` / `42 days`, pluralised. */
export function formatDayCount(days: number): string {
  const magnitude = Math.abs(days)
  return `${magnitude} ${magnitude === 1 ? 'day' : 'days'}`
}

/**
 * Plain-language due status for an invoice that is not overdue, used as the
 * text in the "Overdue by" column so the cell is never just blank.
 */
export function formatDueRelative(daysPastDue: number): string {
  if (daysPastDue === 0) return 'Due today'
  if (daysPastDue > 0) return `${formatDayCount(daysPastDue)} late`
  return `In ${formatDayCount(daysPastDue)}`
}

/** `1` -> `1st`, for ordinal-free contexts we still want to read naturally. */
export function formatCount(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`)
  return `${count.toLocaleString('en-US')} ${word}`
}
