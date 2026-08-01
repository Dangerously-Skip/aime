/**
 * Builds the 200-invoice fixture set.
 *
 * Two things this generator does on purpose:
 *
 * 1. **Dates are relative to a `today` you pass in.** A fixture with hardcoded
 *    2024 dates rots: every invoice drifts further overdue until the demo shows
 *    200 rows at "90+ days" and the aging buckets stop meaning anything.
 * 2. **Cohorts are sized explicitly, then shuffled.** Drawing each invoice from
 *    one probability distribution gives you a binomial wobble in the overdue
 *    count, so the interesting cases are sometimes absent. Building exact
 *    cohorts and interleaving them guarantees every bucket and every empty-state
 *    path is represented, while the shuffle stops the unsorted order from
 *    accidentally grouping them.
 */

import { addDays, daysBetween } from '../domain/dates.ts'
import type { Invoice, InvoiceStatus, IsoDate } from '../domain/invoice.ts'
import { CUSTOMER_NAMES } from './customers.ts'
import { createRng, type Rng } from './seededRandom.ts'

export const DEFAULT_SEED = 20_260_801
export const DEFAULT_INVOICE_COUNT = 200

/** Common net payment terms, in days. */
const PAYMENT_TERMS = [14, 30, 30, 30, 45, 60] as const

interface Cohort {
  readonly status: InvoiceStatus
  /** Share of the total, before rounding. Shares must sum to 1. */
  readonly share: number
  /** Inclusive range of `dueDate - today`, in days. Negative is in the past. */
  readonly dueOffset: readonly [number, number]
}

/**
 * Roughly what a small business's receivables ledger looks like: most invoices
 * settled, a healthy pipeline not yet due, and a long tail of late ones
 * concentrated in the first 30 days but reaching well past 90.
 */
const COHORTS: readonly Cohort[] = [
  { status: 'paid', share: 0.5, dueOffset: [-300, -2] },
  { status: 'sent', share: 0.06, dueOffset: [-30, -1] }, // overdue 1-30
  { status: 'sent', share: 0.035, dueOffset: [-60, -31] }, // overdue 31-60
  { status: 'sent', share: 0.025, dueOffset: [-90, -61] }, // overdue 61-90
  { status: 'sent', share: 0.02, dueOffset: [-260, -91] }, // overdue 90+
  { status: 'sent', share: 0.07, dueOffset: [0, 7] }, // due soon
  { status: 'sent', share: 0.21, dueOffset: [8, 75] }, // open
  { status: 'draft', share: 0.045, dueOffset: [5, 60] },
  { status: 'void', share: 0.035, dueOffset: [-120, 30] },
]

/**
 * Invoice amounts, skewed so most are modest and a few are large. Squaring a
 * uniform draw approximates the long-tailed shape of real billing far better
 * than a flat range, which matters because it makes sorting by amount and the
 * outstanding total behave like real data.
 */
function amountCents(rng: Rng): number {
  const skewed = rng.next() ** 2.2
  const dollars = 120 + skewed * 47_880
  // Real invoices land on tidy-ish figures far more often than on random cents.
  if (rng.chance(0.55)) return Math.round(dollars) * 100
  if (rng.chance(0.5)) return Math.round(dollars / 5) * 5 * 100
  return Math.round(dollars * 100)
}

/**
 * Distribute a total across cohorts by their shares, using largest-remainder so
 * the parts sum to exactly `total` rather than 199 or 201.
 */
function allocate(total: number, cohorts: readonly Cohort[]): number[] {
  const exact = cohorts.map((c) => c.share * total)
  const counts = exact.map(Math.floor)
  let remaining = total - counts.reduce((sum, n) => sum + n, 0)

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)

  for (const { index } of byRemainder) {
    if (remaining <= 0) break
    counts[index] = (counts[index] ?? 0) + 1
    remaining -= 1
  }
  return counts
}

/** Fisher-Yates, driven by the seeded RNG so the order is reproducible. */
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i)
    const a = items[i]!
    const b = items[j]!
    items[i] = b
    items[j] = a
  }
  return items
}

/**
 * When a paid invoice was actually settled. Clamped to `[issueDate, today]`:
 * a payment can neither precede the invoice nor be recorded in the future.
 */
function resolvePaidDate(
  rng: Rng,
  issueDate: IsoDate,
  dueDate: IsoDate,
  today: IsoDate,
): IsoDate {
  // Most customers pay near the due date; some pay early, some pay late.
  const offset = rng.chance(0.68) ? rng.int(-10, 2) : rng.int(3, 25)
  const candidate = addDays(dueDate, offset)

  if (daysBetween(issueDate, candidate) < 0) return issueDate
  if (daysBetween(candidate, today) < 0) return today
  return candidate
}

export interface GenerateOptions {
  /** The date the dataset is built relative to. */
  readonly today: IsoDate
  readonly count?: number
  readonly seed?: number
}

export function generateInvoices({
  today,
  count = DEFAULT_INVOICE_COUNT,
  seed = DEFAULT_SEED,
}: GenerateOptions): Invoice[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer, received ${count}`)
  }

  const rng = createRng(seed)
  const counts = allocate(count, COHORTS)

  // Build without an invoice number first; numbers are assigned last so they
  // ascend with issue date the way a real sequence does.
  const drafted: Omit<Invoice, 'number'>[] = []

  COHORTS.forEach((cohort, cohortIndex) => {
    const cohortSize = counts[cohortIndex] ?? 0

    for (let i = 0; i < cohortSize; i += 1) {
      const [minOffset, maxOffset] = cohort.dueOffset
      const dueDate = addDays(today, rng.int(minOffset, maxOffset))
      const issueDate = addDays(dueDate, -rng.pick(PAYMENT_TERMS))
      const customerIndex = rng.int(0, CUSTOMER_NAMES.length - 1)

      drafted.push({
        id: `inv_${String(drafted.length + 1).padStart(4, '0')}`,
        customerId: `cus_${String(customerIndex + 1).padStart(3, '0')}`,
        customerName: CUSTOMER_NAMES[customerIndex]!,
        issueDate,
        dueDate,
        amountCents: amountCents(rng),
        currency: 'USD',
        status: cohort.status,
        paidDate:
          cohort.status === 'paid'
            ? resolvePaidDate(rng, issueDate, dueDate, today)
            : null,
      })
    }
  })

  shuffle(drafted, rng)

  const byIssueDate = [...drafted].sort((a, b) => a.issueDate.localeCompare(b.issueDate))
  const numberById = new Map<string, string>(
    byIssueDate.map((inv, index) => [inv.id, `INV-${1001 + index}`]),
  )

  return drafted.map((inv) => ({ ...inv, number: numberById.get(inv.id)! }))
}
