/**
 * Table state, as a reducer over `TableQuery`.
 *
 * All the derived data (rows, counts, totals) is recomputed by
 * `buildTableViewModel`, never stored. Caching a filtered array in state is how
 * data tables end up showing 25 rows while claiming there are 28 — one of the
 * two copies is always a render behind. Deriving is cheap here, so there is
 * nothing to trade off.
 */

import { useCallback, useMemo, useReducer } from 'react'
import type { AgingBucket, ScoredInvoice } from '../../domain/invoice.ts'
import {
  buildTableViewModel,
  DEFAULT_QUERY,
  defaultDirectionFor,
  type PageSize,
  type QuickView,
  type SortField,
  type TableQuery,
  type TableViewModel,
} from './tableModel.ts'

type Action =
  | { type: 'search'; value: string }
  | { type: 'view'; value: QuickView }
  | { type: 'toggleBucket'; value: AgingBucket }
  | { type: 'customer'; value: string | null }
  | { type: 'sort'; field: SortField }
  | { type: 'page'; value: number }
  | { type: 'pageSize'; value: PageSize }
  | { type: 'reset' }

/**
 * Any change that alters *which* rows match sends the user back to page 1.
 *
 * Without this, filtering from 200 rows down to 3 while sitting on page 6 shows
 * an empty table. `paginate` clamps as a safety net, but resetting is the
 * honest behaviour: a new result set is a new list, and you read it from the top.
 * Changing the *sort* deliberately does not reset — you are reordering the same
 * rows, and being thrown to page 1 mid-review would be irritating.
 */
function reduce(state: TableQuery, action: Action): TableQuery {
  switch (action.type) {
    case 'search':
      return { ...state, search: action.value, page: 1 }

    case 'view':
      return {
        ...state,
        view: action.value,
        // Aging bands only mean something for overdue debt, so leaving them set
        // while switching to "Paid" would guarantee an empty table.
        agingBuckets: action.value === 'overdue' || action.value === 'all'
          ? state.agingBuckets
          : [],
        page: 1,
      }

    case 'toggleBucket': {
      const active = state.agingBuckets.includes(action.value)
      const agingBuckets = active
        ? state.agingBuckets.filter((bucket) => bucket !== action.value)
        : [...state.agingBuckets, action.value]
      return { ...state, agingBuckets, page: 1 }
    }

    case 'customer':
      return { ...state, customerId: action.value, page: 1 }

    case 'sort': {
      // Clicking the active column flips it; a new column starts in whichever
      // direction is more useful for that data type.
      const direction =
        state.sort.field === action.field
          ? state.sort.direction === 'asc'
            ? 'desc'
            : 'asc'
          : defaultDirectionFor(action.field)
      return { ...state, sort: { field: action.field, direction } }
    }

    case 'page':
      return { ...state, page: action.value }

    case 'pageSize':
      // Growing the page size can orphan the current page; start over rather
      // than guessing which rows the user was looking at.
      return { ...state, pageSize: action.value, page: 1 }

    case 'reset':
      return DEFAULT_QUERY
  }
}

export interface InvoiceTableController {
  readonly query: TableQuery
  readonly model: TableViewModel
  /** True when any filter is narrowing the set, so the UI can offer a reset. */
  readonly isFiltered: boolean
  setSearch: (value: string) => void
  setView: (value: QuickView) => void
  toggleBucket: (value: AgingBucket) => void
  setCustomer: (value: string | null) => void
  toggleSort: (field: SortField) => void
  setPage: (value: number) => void
  setPageSize: (value: PageSize) => void
  reset: () => void
}

export function useInvoiceTable(
  invoices: readonly ScoredInvoice[],
  initialQuery: Partial<TableQuery> = {},
): InvoiceTableController {
  const [query, dispatch] = useReducer(reduce, { ...DEFAULT_QUERY, ...initialQuery })

  const model = useMemo(() => buildTableViewModel(invoices, query), [invoices, query])

  const isFiltered =
    query.search.trim() !== '' ||
    query.view !== 'all' ||
    query.agingBuckets.length > 0 ||
    query.customerId !== null

  return {
    query,
    model,
    isFiltered,
    setSearch: useCallback((value) => dispatch({ type: 'search', value }), []),
    setView: useCallback((value) => dispatch({ type: 'view', value }), []),
    toggleBucket: useCallback((value) => dispatch({ type: 'toggleBucket', value }), []),
    setCustomer: useCallback((value) => dispatch({ type: 'customer', value }), []),
    toggleSort: useCallback((field) => dispatch({ type: 'sort', field }), []),
    setPage: useCallback((value) => dispatch({ type: 'page', value }), []),
    setPageSize: useCallback((value) => dispatch({ type: 'pageSize', value }), []),
    reset: useCallback(() => dispatch({ type: 'reset' }), []),
  }
}
