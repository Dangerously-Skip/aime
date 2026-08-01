import { buildPageRange } from '../pageRange.ts'
import { PAGE_SIZES, type PageSize, type Pagination } from '../tableModel.ts'

interface TablePaginationProps {
  readonly pagination: Pagination
  readonly onPage: (page: number) => void
  readonly onPageSize: (size: PageSize) => void
}

export function TablePagination({
  pagination,
  onPage,
  onPageSize,
}: TablePaginationProps) {
  const { page, pageCount, pageSize, totalRows, rangeStart, rangeEnd } = pagination
  const slots = buildPageRange(page, pageCount)

  return (
    <div className="pagination">
      <div className="pagination__size">
        <label className="field__label" htmlFor="page-size">
          Rows per page
        </label>
        <select
          id="page-size"
          className="input input--compact"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {/*
        The count lives in a live region so that filtering — which is the main
        way this number changes — is announced. Without it a screen reader user
        types into the search box and gets no feedback that anything happened.
      */}
      <p className="pagination__status" role="status" aria-live="polite">
        {totalRows === 0
          ? 'No invoices'
          : `Showing ${rangeStart}–${rangeEnd} of ${totalRows.toLocaleString('en-US')}`}
      </p>

      <nav className="pagination__nav" aria-label="Pagination">
        <button
          type="button"
          className="page-button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          <span aria-hidden="true">‹</span>
          <span className="sr-only">Previous page</span>
        </button>

        {slots.map((slot, index) =>
          slot === 'gap' ? (
            // eslint-disable-next-line react/no-array-index-key -- gaps carry no identity
            <span key={`gap-${index}`} className="page-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              className="page-button"
              data-active={slot === page}
              aria-current={slot === page ? 'page' : undefined}
              // A bare "3" as the accessible name is meaningless out of context.
              aria-label={`Page ${slot}`}
              onClick={() => onPage(slot)}
            >
              {slot}
            </button>
          ),
        )}

        <button
          type="button"
          className="page-button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
        >
          <span aria-hidden="true">›</span>
          <span className="sr-only">Next page</span>
        </button>
      </nav>
    </div>
  )
}
