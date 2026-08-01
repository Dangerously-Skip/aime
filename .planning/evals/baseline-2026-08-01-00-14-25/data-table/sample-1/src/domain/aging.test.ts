import { describe, expect, it } from 'vitest'
import { agingBucketFor, scoreInvoice, severityFor } from './aging.ts'
import type { Invoice, InvoiceStatus } from './invoice.ts'

const TODAY = '2026-08-01'

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv_1',
    number: 'INV-1000',
    customerId: 'cus_1',
    customerName: 'Northwind Traders',
    issueDate: '2026-07-01',
    dueDate: '2026-07-31',
    amountCents: 250_00,
    currency: 'USD',
    status: 'sent',
    paidDate: null,
    ...overrides,
  }
}

describe('agingBucketFor', () => {
  it('places days in the standard AR buckets', () => {
    expect(agingBucketFor(-10)).toBe('current')
    expect(agingBucketFor(0)).toBe('current')
    expect(agingBucketFor(1)).toBe('1-30')
    expect(agingBucketFor(30)).toBe('1-30')
    expect(agingBucketFor(31)).toBe('31-60')
    expect(agingBucketFor(60)).toBe('31-60')
    expect(agingBucketFor(61)).toBe('61-90')
    expect(agingBucketFor(90)).toBe('61-90')
    expect(agingBucketFor(91)).toBe('90+')
    expect(agingBucketFor(9_999)).toBe('90+')
  })
})

describe('scoreInvoice payment state', () => {
  it('marks a sent invoice past its due date as overdue', () => {
    const scored = scoreInvoice(invoice({ dueDate: '2026-07-02' }), TODAY)
    expect(scored.paymentState).toBe('overdue')
    expect(scored.isOverdue).toBe(true)
    expect(scored.daysPastDue).toBe(30)
  })

  it('does NOT treat the due date itself as overdue', () => {
    // Boundary that matters: you have all of the due date to pay.
    const scored = scoreInvoice(invoice({ dueDate: TODAY }), TODAY)
    expect(scored.daysPastDue).toBe(0)
    expect(scored.isOverdue).toBe(false)
    expect(scored.paymentState).toBe('dueSoon')
  })

  it('becomes overdue the day after the due date', () => {
    const scored = scoreInvoice(invoice({ dueDate: '2026-07-31' }), TODAY)
    expect(scored.daysPastDue).toBe(1)
    expect(scored.paymentState).toBe('overdue')
  })

  it('flags an invoice inside the 7-day window as due soon', () => {
    expect(scoreInvoice(invoice({ dueDate: '2026-08-08' }), TODAY).paymentState).toBe(
      'dueSoon',
    )
  })

  it('treats an invoice just outside the window as merely open', () => {
    expect(scoreInvoice(invoice({ dueDate: '2026-08-09' }), TODAY).paymentState).toBe(
      'open',
    )
  })

  it.each<[InvoiceStatus, string]>([
    ['draft', 'draft'],
    ['void', 'void'],
    ['paid', 'paid'],
  ])('never marks a %s invoice overdue even when long past due', (status, expected) => {
    const scored = scoreInvoice(
      invoice({ status, dueDate: '2025-01-01', paidDate: status === 'paid' ? '2025-01-05' : null }),
      TODAY,
    )
    expect(scored.paymentState).toBe(expected)
    expect(scored.isOverdue).toBe(false)
    // The overdue count is the number the user trusts; it must not be inflated
    // by records where nothing is actually owed.
    expect(scored.agingBucket).toBe('current')
  })
})

describe('scoreInvoice outstanding amount', () => {
  it('counts an issued unpaid invoice as outstanding', () => {
    expect(scoreInvoice(invoice({ status: 'sent' }), TODAY).outstandingCents).toBe(250_00)
  })

  it.each<InvoiceStatus>(['paid', 'void', 'draft'])(
    'excludes %s invoices from the outstanding total',
    (status) => {
      expect(scoreInvoice(invoice({ status }), TODAY).outstandingCents).toBe(0)
    },
  )
})

describe('severityFor', () => {
  it('escalates with the aging bucket', () => {
    const at = (dueDate: string) => severityFor(scoreInvoice(invoice({ dueDate }), TODAY))
    expect(at('2026-09-01')).toBe(0) // not due yet
    expect(at('2026-07-20')).toBe(1) // 12 days
    expect(at('2026-06-20')).toBe(2) // 42 days
    expect(at('2026-05-20')).toBe(3) // 73 days
    expect(at('2026-01-20')).toBe(4) // 193 days
  })

  it('is 0 for anything not owed, however old', () => {
    expect(
      severityFor(scoreInvoice(invoice({ status: 'paid', dueDate: '2020-01-01' }), TODAY)),
    ).toBe(0)
  })
})
