import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  type AgingBucket,
} from '../../../domain/invoice.ts'
import {
  QUICK_VIEWS,
  QUICK_VIEW_LABELS,
  type CustomerOption,
  type QuickView,
} from '../tableModel.ts'

interface ToolbarProps {
  readonly search: string
  readonly view: QuickView
  readonly activeBuckets: readonly AgingBucket[]
  readonly customerId: string | null
  readonly viewCounts: Record<QuickView, number>
  readonly bucketCounts: Record<AgingBucket, number>
  readonly customers: readonly CustomerOption[]
  readonly isFiltered: boolean
  readonly onSearch: (value: string) => void
  readonly onView: (value: QuickView) => void
  readonly onToggleBucket: (value: AgingBucket) => void
  readonly onCustomer: (value: string | null) => void
  readonly onReset: () => void
}

/** Aging bands, excluding `current` — an aging filter is about lateness. */
const OVERDUE_BUCKETS = AGING_BUCKETS.filter((bucket) => bucket !== 'current')

export function Toolbar({
  search,
  view,
  activeBuckets,
  customerId,
  viewCounts,
  bucketCounts,
  customers,
  isFiltered,
  onSearch,
  onView,
  onToggleBucket,
  onCustomer,
  onReset,
}: ToolbarProps) {
  // Aging bands only apply to overdue debt, so offering them beside "Paid"
  // would be offering a guaranteed empty result.
  const agingApplies = view === 'all' || view === 'overdue'

  return (
    <div className="toolbar">
      {/*
        A tablist would be wrong here: these filter one table rather than
        swapping panels, so they are toggle buttons in a labelled group and
        `aria-pressed` carries the state.
      */}
      <div className="chips" role="group" aria-label="Filter by status">
        {QUICK_VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            data-view={option}
            data-active={view === option}
            aria-pressed={view === option}
            /*
              Explicit label because the badge would otherwise be glued to the
              text and announced as "Overdue28". Spelling out "invoices" also
              stops the bare number sounding like part of the status name.
            */
            aria-label={`${QUICK_VIEW_LABELS[option]}, ${viewCounts[option]} invoices`}
            onClick={() => onView(option)}
          >
            {QUICK_VIEW_LABELS[option]}
            <span className="chip__count">{viewCounts[option]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar__row">
        <div className="field field--search">
          <label className="field__label" htmlFor="invoice-search">
            Search
          </label>
          <input
            id="invoice-search"
            type="search"
            className="input"
            placeholder="Invoice number or customer"
            value={search}
            autoComplete="off"
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="invoice-customer">
            Customer
          </label>
          <select
            id="invoice-customer"
            className="input"
            value={customerId ?? ''}
            onChange={(event) => onCustomer(event.target.value || null)}
          >
            <option value="">All customers</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} ({customer.invoiceCount})
              </option>
            ))}
          </select>
        </div>

        {agingApplies && (
          <div className="field">
            <span className="field__label" id="aging-label">
              Age of debt
            </span>
            <div className="buckets" role="group" aria-labelledby="aging-label">
              {OVERDUE_BUCKETS.map((bucket) => {
                const count = bucketCounts[bucket]
                return (
                  <button
                    key={bucket}
                    type="button"
                    className="bucket"
                    data-bucket={bucket}
                    data-active={activeBuckets.includes(bucket)}
                    aria-pressed={activeBuckets.includes(bucket)}
                    aria-label={`${AGING_BUCKET_LABELS[bucket]} overdue, ${count} invoices`}
                    disabled={count === 0 && !activeBuckets.includes(bucket)}
                    onClick={() => onToggleBucket(bucket)}
                  >
                    {AGING_BUCKET_LABELS[bucket]}
                    <span className="bucket__count">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {isFiltered && (
          <button type="button" className="button button--ghost" onClick={onReset}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
