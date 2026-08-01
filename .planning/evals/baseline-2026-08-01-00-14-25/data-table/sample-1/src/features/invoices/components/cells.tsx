import { severityFor } from '../../../domain/aging.ts'
import {
  PAYMENT_STATE_LABELS,
  type PaymentState,
  type ScoredInvoice,
} from '../../../domain/invoice.ts'
import { formatDayCount } from '../../../lib/format.ts'

export function StatusBadge({ state }: { state: PaymentState }) {
  return (
    <span className="badge" data-state={state}>
      {PAYMENT_STATE_LABELS[state]}
    </span>
  )
}

/**
 * The "Days late" cell — the one the eye lands on when scanning.
 *
 * Severity drives a colour, but the number is always spelled out as text and
 * the badge carries a word ("late"). Colour alone would exclude the ~8% of men
 * with a colour vision deficiency, and would vanish entirely in a printed or
 * greyscale copy of the aging report, which is a format finance teams
 * genuinely still use.
 */
export function DaysLateCell({ invoice }: { invoice: ScoredInvoice }) {
  if (!invoice.isOverdue) {
    return (
      <span className="cell-empty">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not overdue</span>
      </span>
    )
  }

  return (
    <span className="days-late" data-severity={severityFor(invoice)}>
      {formatDayCount(invoice.daysPastDue)}
      <span className="sr-only"> late</span>
    </span>
  )
}
