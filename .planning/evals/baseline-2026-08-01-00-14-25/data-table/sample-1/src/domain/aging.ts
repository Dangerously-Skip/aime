/**
 * Turns a stored invoice into the time-dependent shape the table renders.
 *
 * `today` is always an explicit parameter, never read from the clock in here.
 * That keeps the whole module pure: the same inputs give the same output, so
 * tests can pin a date instead of mocking timers, and the numbers on screen
 * can never disagree with each other because two calls straddled midnight.
 */

import { daysBetween } from './dates.ts'
import {
  type AgingBucket,
  type Invoice,
  type IsoDate,
  type PaymentState,
  type ScoredInvoice,
} from './invoice.ts'

/** An unpaid invoice within this many days of its due date reads as "due soon". */
export const DUE_SOON_WINDOW_DAYS = 7

/**
 * Days past due, from the due date to today.
 * Positive = late, 0 = due today, negative = not yet due.
 */
export function daysPastDue(invoice: Invoice, today: IsoDate): number {
  return daysBetween(invoice.dueDate, today)
}

/**
 * Which aging bucket a number of days past due falls into.
 * Boundaries are inclusive at the top (30 is in `1-30`, 31 starts `31-60`).
 */
export function agingBucketFor(days: number): AgingBucket {
  if (days <= 0) return 'current'
  if (days <= 30) return '1-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

/**
 * Resolve the user-facing payment state.
 *
 * Only a `sent` invoice can be overdue. A draft has not been issued, so nobody
 * owes anything yet; a void invoice has been cancelled. Treating either as
 * overdue would inflate the number the user is scanning for, which is the one
 * number that has to be trustworthy.
 */
export function paymentStateFor(invoice: Invoice, days: number): PaymentState {
  switch (invoice.status) {
    case 'draft':
      return 'draft'
    case 'void':
      return 'void'
    case 'paid':
      return 'paid'
    case 'sent':
      if (days > 0) return 'overdue'
      if (days >= -DUE_SOON_WINDOW_DAYS) return 'dueSoon'
      return 'open'
  }
}

/** Attach all derived, time-dependent fields to an invoice. */
export function scoreInvoice(invoice: Invoice, today: IsoDate): ScoredInvoice {
  const days = daysPastDue(invoice, today)
  const paymentState = paymentStateFor(invoice, days)
  const isOverdue = paymentState === 'overdue'

  return {
    ...invoice,
    daysPastDue: days,
    paymentState,
    isOverdue,
    agingBucket: isOverdue ? agingBucketFor(days) : 'current',
    // Only an issued-and-unpaid invoice is a receivable. Drafts are not yet
    // owed and voids never will be, so neither belongs in an outstanding total.
    outstandingCents: invoice.status === 'sent' ? invoice.amountCents : 0,
  }
}

export function scoreInvoices(
  invoices: readonly Invoice[],
  today: IsoDate,
): ScoredInvoice[] {
  return invoices.map((invoice) => scoreInvoice(invoice, today))
}

/**
 * Visual urgency, 0 (nothing owed) to 4 (90+ days late). The table maps this
 * to colour *and* the row always shows the day count as text, so the severity
 * is never communicated by colour alone.
 */
export function severityFor(invoice: ScoredInvoice): 0 | 1 | 2 | 3 | 4 {
  if (!invoice.isOverdue) return 0
  switch (invoice.agingBucket) {
    case '1-30':
      return 1
    case '31-60':
      return 2
    case '61-90':
      return 3
    case '90+':
      return 4
    case 'current':
      return 0
  }
}
