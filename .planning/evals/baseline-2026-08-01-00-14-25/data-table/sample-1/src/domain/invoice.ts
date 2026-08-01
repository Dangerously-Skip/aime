/**
 * Invoice domain types.
 *
 * Two deliberate choices here:
 *
 * 1. `amountCents` is an integer in minor units, never a float. Floating point
 *    money silently loses cents (0.1 + 0.2 !== 0.3) and those errors compound
 *    once you start summing 200 rows into an "outstanding" total.
 * 2. Dates are calendar dates (`YYYY-MM-DD`), not timestamps. An invoice is due
 *    on a *day*, not at an instant, so storing a timestamp invites timezone
 *    bugs where the same invoice is overdue for one user and not another.
 */

/** A calendar date in `YYYY-MM-DD` form. */
export type IsoDate = string

/**
 * The lifecycle status recorded against the invoice by the billing system.
 * This is *stored* state, distinct from the *derived* payment state below —
 * "overdue" is never stored, because it changes as time passes without anyone
 * touching the record.
 */
export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export interface Invoice {
  readonly id: string
  /** Human-facing reference, e.g. `INV-1042`. */
  readonly number: string
  readonly customerId: string
  readonly customerName: string
  readonly issueDate: IsoDate
  readonly dueDate: IsoDate
  /** Integer minor units (cents). See note above. */
  readonly amountCents: number
  readonly currency: 'USD'
  readonly status: InvoiceStatus
  /** Set only when `status === 'paid'`. */
  readonly paidDate: IsoDate | null
}

/**
 * What the user actually cares about, computed from `status` + `dueDate` + today.
 *
 * `overdue` is the one this whole view exists to surface.
 */
export const PAYMENT_STATES = [
  'overdue',
  'dueSoon',
  'open',
  'paid',
  'draft',
  'void',
] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  open: 'Open',
  paid: 'Paid',
  draft: 'Draft',
  void: 'Void',
}

/**
 * Standard accounts-receivable aging buckets. These are the vocabulary
 * collections teams already work in ("what's in 90-plus?"), so the filters
 * mirror them rather than inventing new bands.
 */
export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current',
  '1-30': '1-30 days',
  '31-60': '31-60 days',
  '61-90': '61-90 days',
  '90+': '90+ days',
}

/** An invoice with the time-dependent fields resolved against a given `today`. */
export interface ScoredInvoice extends Invoice {
  /**
   * Positive when past due, negative when still ahead of the due date,
   * 0 on the due date itself. Computed even for paid invoices (where it
   * describes the due date, not a debt) so sorting stays total.
   */
  readonly daysPastDue: number
  readonly paymentState: PaymentState
  readonly agingBucket: AgingBucket
  /** True when money is genuinely owed and late. Drives the urgent styling. */
  readonly isOverdue: boolean
  /** Cents still owed: the amount for unpaid invoices, 0 otherwise. */
  readonly outstandingCents: number
}
