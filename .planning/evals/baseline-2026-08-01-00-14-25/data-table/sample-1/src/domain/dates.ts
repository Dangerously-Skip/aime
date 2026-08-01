/**
 * Calendar-date arithmetic.
 *
 * Everything here goes through `Date.UTC` deliberately. The naive approach —
 * `new Date('2026-03-29') - new Date('2026-03-28')` in local time — breaks
 * across DST boundaries, where a "day" is 23 or 25 hours long and the division
 * yields 0.958 or 1.04 days. Flooring that gives an off-by-one on exactly the
 * days a European user crosses the spring/autumn transition, which is the kind
 * of bug that shows up as "this invoice says 30 days overdue but the report
 * says 31". Anchoring to UTC midnight makes every day exactly 86400000ms.
 */

import type { IsoDate } from './invoice.ts'

const MS_PER_DAY = 86_400_000
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Parse `YYYY-MM-DD` into a UTC-midnight epoch value.
 * @throws if the string is not a valid calendar date.
 */
export function parseIsoDate(date: IsoDate): number {
  const match = ISO_DATE_PATTERN.exec(date)
  if (!match) {
    throw new TypeError(`Expected a YYYY-MM-DD date, received "${date}"`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  const epoch = Date.UTC(year, month - 1, day)

  // Date.UTC rolls overflow forward (month 13 becomes January of the next
  // year), so round-trip to reject things like 2026-02-30 rather than
  // silently reading them as 2026-03-02.
  const roundTrip = new Date(epoch)
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new RangeError(`"${date}" is not a real calendar date`)
  }
  return epoch
}

/** Format a UTC-midnight epoch value back to `YYYY-MM-DD`. */
export function toIsoDate(epoch: number): IsoDate {
  return new Date(epoch).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return (parseIsoDate(to) - parseIsoDate(from)) / MS_PER_DAY
}

/** Shift a calendar date by a whole number of days. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return toIsoDate(parseIsoDate(date) + days * MS_PER_DAY)
}

/**
 * Today as a calendar date in the viewer's local timezone.
 *
 * Local, not UTC, is correct here: a user in Sydney at 09:00 on the 5th should
 * see the 5th, even though it is still the 4th in UTC. We read the local
 * components and re-anchor them to UTC midnight so all downstream arithmetic
 * stays in the single UTC-based space the rest of this module assumes.
 */
export function todayIsoDate(now: Date = new Date()): IsoDate {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
