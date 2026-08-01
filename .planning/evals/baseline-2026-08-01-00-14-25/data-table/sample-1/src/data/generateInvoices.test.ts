import { describe, expect, it } from 'vitest'
import { scoreInvoices } from '../domain/aging.ts'
import { AGING_BUCKETS, INVOICE_STATUSES } from '../domain/invoice.ts'
import { daysBetween } from '../domain/dates.ts'
import { DEFAULT_INVOICE_COUNT, generateInvoices } from './generateInvoices.ts'

const TODAY = '2026-08-01'
const invoices = generateInvoices({ today: TODAY })
const scored = scoreInvoices(invoices, TODAY)

describe('generateInvoices', () => {
  it('produces exactly 200 invoices by default', () => {
    expect(invoices).toHaveLength(DEFAULT_INVOICE_COUNT)
  })

  it('is deterministic for a given seed', () => {
    expect(generateInvoices({ today: TODAY })).toEqual(invoices)
  })

  it('produces a different dataset for a different seed', () => {
    expect(generateInvoices({ today: TODAY, seed: 999 })).not.toEqual(invoices)
  })

  it('honours an explicit count, including the empty case', () => {
    expect(generateInvoices({ today: TODAY, count: 7 })).toHaveLength(7)
    expect(generateInvoices({ today: TODAY, count: 0 })).toHaveLength(0)
  })

  it('rejects a nonsensical count', () => {
    expect(() => generateInvoices({ today: TODAY, count: -1 })).toThrow(RangeError)
    expect(() => generateInvoices({ today: TODAY, count: 1.5 })).toThrow(RangeError)
  })

  it('gives every invoice a unique id and number', () => {
    expect(new Set(invoices.map((i) => i.id)).size).toBe(invoices.length)
    expect(new Set(invoices.map((i) => i.number)).size).toBe(invoices.length)
  })

  it('numbers invoices in ascending issue-date order', () => {
    const byNumber = [...invoices].sort((a, b) => a.number.localeCompare(b.number))
    for (let i = 1; i < byNumber.length; i += 1) {
      expect(byNumber[i]!.issueDate >= byNumber[i - 1]!.issueDate).toBe(true)
    }
  })
})

describe('generated invoice integrity', () => {
  it('always issues an invoice before it falls due', () => {
    for (const invoice of invoices) {
      expect(daysBetween(invoice.issueDate, invoice.dueDate)).toBeGreaterThan(0)
    }
  })

  it('uses integer cent amounts within a plausible range', () => {
    for (const invoice of invoices) {
      expect(Number.isInteger(invoice.amountCents)).toBe(true)
      expect(invoice.amountCents).toBeGreaterThan(0)
      expect(invoice.amountCents).toBeLessThan(50_000_00)
    }
  })

  it('sets paidDate exactly when the invoice is paid', () => {
    for (const invoice of invoices) {
      if (invoice.status === 'paid') {
        expect(invoice.paidDate).not.toBeNull()
      } else {
        expect(invoice.paidDate).toBeNull()
      }
    }
  })

  it('never records a payment before issue or in the future', () => {
    for (const invoice of invoices) {
      if (invoice.paidDate === null) continue
      expect(daysBetween(invoice.issueDate, invoice.paidDate)).toBeGreaterThanOrEqual(0)
      expect(daysBetween(invoice.paidDate, TODAY)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('generated dataset shape', () => {
  it('covers every invoice status', () => {
    const present = new Set(invoices.map((i) => i.status))
    for (const status of INVOICE_STATUSES) {
      expect(present, `expected at least one ${status} invoice`).toContain(status)
    }
  })

  it('covers every aging bucket, so no filter is dead on arrival', () => {
    const present = new Set(scored.map((i) => i.agingBucket))
    for (const bucket of AGING_BUCKETS) {
      expect(present, `expected at least one invoice in ${bucket}`).toContain(bucket)
    }
  })

  it('leaves a meaningful but not overwhelming number overdue', () => {
    // The view exists to surface these. Too few and the demo shows nothing;
    // too many and the aging buckets stop discriminating.
    const overdue = scored.filter((i) => i.isOverdue)
    expect(overdue.length).toBeGreaterThanOrEqual(15)
    expect(overdue.length).toBeLessThanOrEqual(60)
  })

  it('includes due-soon invoices for the near-term filter', () => {
    expect(scored.filter((i) => i.paymentState === 'dueSoon').length).toBeGreaterThan(0)
  })

  it('spreads invoices across many customers, with repeats', () => {
    const customers = new Set(invoices.map((i) => i.customerId))
    expect(customers.size).toBeGreaterThan(20)
    expect(customers.size).toBeLessThan(invoices.length)
  })

  it('keeps customerId and customerName consistently paired', () => {
    const pairs = new Map<string, string>()
    for (const invoice of invoices) {
      const existing = pairs.get(invoice.customerId)
      if (existing === undefined) pairs.set(invoice.customerId, invoice.customerName)
      else expect(invoice.customerName).toBe(existing)
    }
  })

  it('does not cluster overdue invoices at the start of the unsorted array', () => {
    // If the generator emitted cohorts in order, the default (unsorted) data
    // would be misleadingly grouped.
    const firstHalfOverdue = scored.slice(0, 100).filter((i) => i.isOverdue).length
    const secondHalfOverdue = scored.slice(100).filter((i) => i.isOverdue).length
    expect(firstHalfOverdue).toBeGreaterThan(0)
    expect(secondHalfOverdue).toBeGreaterThan(0)
  })
})

describe('dataset stays valid as today moves', () => {
  it.each(['2026-01-01', '2026-02-28', '2026-03-29', '2026-12-31', '2027-06-15'])(
    'generates a coherent dataset relative to %s',
    (today) => {
      const set = generateInvoices({ today })
      expect(set).toHaveLength(DEFAULT_INVOICE_COUNT)

      const rescored = scoreInvoices(set, today)
      // The whole point of a relative fixture: the overdue cohort stays a
      // cohort instead of every invoice ageing into 90+ over time.
      expect(rescored.filter((i) => i.isOverdue).length).toBeGreaterThanOrEqual(15)
      expect(new Set(rescored.map((i) => i.agingBucket)).size).toBe(AGING_BUCKETS.length)
    },
  )
})
