import { severityFor } from '../../../domain/aging.ts'
import type { ScoredInvoice } from '../../../domain/invoice.ts'
import { formatCurrency, formatDate, formatDateLong } from '../../../lib/format.ts'
import type { SortDirection, SortField, SortSpec } from '../tableModel.ts'
import { DaysLateCell, StatusBadge } from './cells.tsx'

interface Column {
  readonly field: SortField
  readonly label: string
  /** Right-align numeric columns so digits line up for scanning. */
  readonly numeric?: boolean
}

const COLUMNS: readonly Column[] = [
  { field: 'number', label: 'Invoice' },
  { field: 'customerName', label: 'Customer' },
  { field: 'paymentState', label: 'Status' },
  { field: 'daysPastDue', label: 'Days late' },
  { field: 'issueDate', label: 'Issued' },
  { field: 'dueDate', label: 'Due' },
  { field: 'amountCents', label: 'Amount', numeric: true },
]

function ariaSortFor(
  column: Column,
  sort: SortSpec,
): 'ascending' | 'descending' | 'none' {
  if (sort.field !== column.field) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function SortIndicator({ direction }: { direction: SortDirection | null }) {
  if (direction === null) {
    return (
      <span className="sort-icon sort-icon--idle" aria-hidden="true">
        ↕
      </span>
    )
  }
  return (
    <span className="sort-icon" aria-hidden="true">
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  )
}

interface InvoiceTableProps {
  readonly rows: readonly ScoredInvoice[]
  readonly sort: SortSpec
  readonly onSort: (field: SortField) => void
  readonly isFiltered: boolean
  readonly onReset: () => void
}

export function InvoiceTable({
  rows,
  sort,
  onSort,
  isFiltered,
  onReset,
}: InvoiceTableProps) {
  if (rows.length === 0) {
    return (
      <div className="empty" role="status">
        <p className="empty__title">No invoices match these filters</p>
        <p className="empty__body">
          Try a different search term, or widen the status and age filters.
        </p>
        {isFiltered && (
          // Worded differently to the toolbar's button so the two are
          // distinguishable to anyone navigating by control name.
          <button type="button" className="button" onClick={onReset}>
            Clear all filters
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">
          Customer invoices, sortable. Currently sorted by{' '}
          {COLUMNS.find((column) => column.field === sort.field)?.label} in{' '}
          {sort.direction === 'asc' ? 'ascending' : 'descending'} order.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const isActive = sort.field === column.field
              return (
                <th
                  key={column.field}
                  scope="col"
                  aria-sort={ariaSortFor(column, sort)}
                  data-numeric={column.numeric ?? false}
                >
                  <button
                    type="button"
                    className="th-sort"
                    data-active={isActive}
                    onClick={() => onSort(column.field)}
                  >
                    <span>{column.label}</span>
                    <SortIndicator direction={isActive ? sort.direction : null} />
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((invoice) => (
            <tr key={invoice.id} data-severity={severityFor(invoice)}>
              {/*
                `th scope="row"` rather than a td: the invoice number is the
                row's identity, so a screen reader announces it alongside each
                cell instead of reading seven unlabelled values.
              */}
              <th scope="row" className="cell-number">
                {invoice.number}
              </th>
              <td className="cell-customer">{invoice.customerName}</td>
              <td>
                <StatusBadge state={invoice.paymentState} />
              </td>
              <td>
                <DaysLateCell invoice={invoice} />
              </td>
              <td className="cell-date">
                <time dateTime={invoice.issueDate} title={formatDateLong(invoice.issueDate)}>
                  {formatDate(invoice.issueDate)}
                </time>
              </td>
              <td className="cell-date">
                <time dateTime={invoice.dueDate} title={formatDateLong(invoice.dueDate)}>
                  {formatDate(invoice.dueDate)}
                </time>
              </td>
              <td className="cell-amount" data-numeric="true">
                {formatCurrency(invoice.amountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
