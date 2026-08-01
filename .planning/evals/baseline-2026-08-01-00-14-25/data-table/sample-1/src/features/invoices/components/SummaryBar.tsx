import { formatCount, formatCurrency, formatDayCount } from '../../../lib/format.ts'
import type { Summary } from '../tableModel.ts'

interface SummaryBarProps {
  readonly summary: Summary
  /** Invoked when the user clicks through from the overdue tile. */
  readonly onShowOverdue: () => void
  readonly isShowingOverdue: boolean
}

/**
 * The answer before the question.
 *
 * A user who opens this page to "check for overdue invoices" should not have to
 * sort, filter or count rows to learn that there are 28 of them worth $491K.
 * The tile states it outright, and doubles as the fastest route to that subset.
 */
export function SummaryBar({
  summary,
  onShowOverdue,
  isShowingOverdue,
}: SummaryBarProps) {
  const hasOverdue = summary.overdueCount > 0

  return (
    <section className="summary" aria-label="Receivables summary">
      <button
        type="button"
        className="summary__tile summary__tile--action"
        data-severity={summary.worstSeverity}
        data-active={isShowingOverdue}
        onClick={onShowOverdue}
        aria-pressed={isShowingOverdue}
        /*
          Without an explicit label this button and the "Overdue" filter chip
          both compute to the accessible name "Overdue", leaving a screen reader
          user with two identically-named controls that do different things.
        */
        aria-label={
          hasOverdue
            ? `Show only overdue invoices: ${summary.overdueCount} totalling ${formatCurrency(summary.overdueCents)}`
            : 'No overdue invoices'
        }
      >
        <span className="summary__label">Overdue</span>
        <span className="summary__value">{summary.overdueCount}</span>
        <span className="summary__meta">
          {hasOverdue ? formatCurrency(summary.overdueCents) : 'Nothing outstanding'}
        </span>
        <span className="summary__hint" aria-hidden="true">
          {isShowingOverdue ? 'Showing' : 'Show only these'}
        </span>
      </button>

      <div className="summary__tile">
        <span className="summary__label">Total outstanding</span>
        <span className="summary__value">{formatCurrency(summary.outstandingCents)}</span>
        <span className="summary__meta">
          Across {formatCount(summary.count, 'invoice')}
        </span>
      </div>

      <div className="summary__tile">
        <span className="summary__label">Oldest debt</span>
        <span className="summary__value">
          {hasOverdue ? formatDayCount(summary.oldestDaysPastDue) : '—'}
        </span>
        <span className="summary__meta">
          {hasOverdue ? 'Past its due date' : 'No invoice past due'}
        </span>
      </div>
    </section>
  )
}
