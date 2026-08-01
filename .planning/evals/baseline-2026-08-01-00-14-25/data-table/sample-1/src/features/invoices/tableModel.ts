/**
 * The entire behaviour of the table as pure functions.
 *
 * Filtering, sorting, pagination and the summary aggregates all live here, with
 * no React and no clock. That is what makes the tricky parts — the empty state,
 * the page clamping when a filter shrinks the result set, the facet counts —
 * cheap to test exhaustively, rather than something you can only poke at through
 * the DOM.
 *
 * Doing this work client-side is a deliberate call for 200 rows: the full set is
 * a few tens of KB, so every keystroke and sort is instant with no spinner. Past
 * a few thousand rows these same signatures move behind the repository.
 */

import { severityFor } from '../../domain/aging.ts'
import {
  type AgingBucket,
  type PaymentState,
  type ScoredInvoice,
} from '../../domain/invoice.ts'

// ---------------------------------------------------------------------------
// Query shape
// ---------------------------------------------------------------------------

/** The one-click segments above the table. */
export const QUICK_VIEWS = [
  'all',
  'overdue',
  'dueSoon',
  'open',
  'paid',
  'draft',
  'void',
] as const
export type QuickView = (typeof QUICK_VIEWS)[number]

export const QUICK_VIEW_LABELS: Record<QuickView, string> = {
  all: 'All',
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  open: 'Open',
  paid: 'Paid',
  draft: 'Draft',
  void: 'Void',
}

export const SORT_FIELDS = [
  'daysPastDue',
  'dueDate',
  'issueDate',
  'number',
  'customerName',
  'amountCents',
  'paymentState',
] as const
export type SortField = (typeof SORT_FIELDS)[number]

export type SortDirection = 'asc' | 'desc'

export interface SortSpec {
  readonly field: SortField
  readonly direction: SortDirection
}

export const PAGE_SIZES = [10, 25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export interface TableQuery {
  readonly search: string
  readonly view: QuickView
  /** Empty means no aging restriction. A non-empty list implies overdue only. */
  readonly agingBuckets: readonly AgingBucket[]
  readonly customerId: string | null
  readonly sort: SortSpec
  /** 1-based. Clamped on the way out, never trusted on the way in. */
  readonly page: number
  readonly pageSize: PageSize
}

/**
 * Most-overdue-first, because that is what the user came here to find.
 *
 * A conventional table would default to newest-issued or invoice number, which
 * buries the 90-day-late invoice somewhere on page 6. Sorting by days past due
 * descending puts the biggest problem in row one before anyone touches a control.
 */
export const DEFAULT_SORT: SortSpec = { field: 'daysPastDue', direction: 'desc' }

export const DEFAULT_QUERY: TableQuery = {
  search: '',
  view: 'all',
  agingBuckets: [],
  customerId: null,
  sort: DEFAULT_SORT,
  page: 1,
  pageSize: 25,
}

/** Sensible initial direction per column: dates and money read high-to-low. */
export function defaultDirectionFor(field: SortField): SortDirection {
  switch (field) {
    case 'number':
    case 'customerName':
      return 'asc'
    case 'daysPastDue':
    case 'dueDate':
    case 'issueDate':
    case 'amountCents':
    case 'paymentState':
      return 'desc'
  }
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * Fold a string for comparison: case, accents and typographic apostrophes all
 * collapse. Without the apostrophe fold, typing `Margie's` fails to find
 * `Margie’s Travel`, which reads as a broken search box to anyone whose keyboard
 * produces a straight quote.
 */
export function normaliseForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[‘’ʼ′]/g, "'") // curly and prime apostrophes
    .replace(/[–—]/g, '-') // en/em dashes
    .toLowerCase()
    .trim()
}

/** Search matches invoice number or customer name, on any word boundary. */
export function matchesSearch(invoice: ScoredInvoice, rawQuery: string): boolean {
  const query = normaliseForSearch(rawQuery)
  if (query === '') return true

  // Every whitespace-separated term must match somewhere, so "north 1042"
  // narrows rather than widens.
  const haystack = `${normaliseForSearch(invoice.number)} ${normaliseForSearch(
    invoice.customerName,
  )}`
  return query.split(/\s+/).every((term) => haystack.includes(term))
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function matchesView(invoice: ScoredInvoice, view: QuickView): boolean {
  // Every quick view other than "all" is named after a payment state, and
  // PAYMENT_STATE_RANK below is a Record<PaymentState, ...>, so adding a state
  // without adding its chip fails to compile.
  return view === 'all' || invoice.paymentState === view
}

function matchesAging(
  invoice: ScoredInvoice,
  buckets: readonly AgingBucket[],
): boolean {
  if (buckets.length === 0) return true
  // Only overdue invoices carry a real bucket, so an aging filter is implicitly
  // an overdue filter — asking for "61-90 days" can only mean lateness.
  return invoice.isOverdue && buckets.includes(invoice.agingBucket)
}

/** Apply every filter except the quick view. Used for facet counting. */
function applyNonViewFilters(
  invoices: readonly ScoredInvoice[],
  query: TableQuery,
): ScoredInvoice[] {
  return invoices.filter(
    (invoice) =>
      matchesSearch(invoice, query.search) &&
      (query.customerId === null || invoice.customerId === query.customerId),
  )
}

export function filterInvoices(
  invoices: readonly ScoredInvoice[],
  query: TableQuery,
): ScoredInvoice[] {
  return applyNonViewFilters(invoices, query).filter(
    (invoice) =>
      matchesView(invoice, query.view) && matchesAging(invoice, query.agingBuckets),
  )
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Urgency order, so sorting by status surfaces problems rather than alphabet. */
const PAYMENT_STATE_RANK: Record<PaymentState, number> = {
  overdue: 5,
  dueSoon: 4,
  open: 3,
  draft: 2,
  paid: 1,
  void: 0,
}

function compareBy(field: SortField, a: ScoredInvoice, b: ScoredInvoice): number {
  switch (field) {
    case 'daysPastDue':
      return a.daysPastDue - b.daysPastDue
    case 'amountCents':
      return a.amountCents - b.amountCents
    case 'dueDate':
      return a.dueDate.localeCompare(b.dueDate)
    case 'issueDate':
      return a.issueDate.localeCompare(b.issueDate)
    case 'number':
      // Numeric-aware so INV-1010 sorts after INV-1009, not between 1 and 2.
      return a.number.localeCompare(b.number, 'en', { numeric: true })
    case 'customerName':
      return a.customerName.localeCompare(b.customerName, 'en', {
        sensitivity: 'base',
        numeric: true,
      })
    case 'paymentState':
      return PAYMENT_STATE_RANK[a.paymentState] - PAYMENT_STATE_RANK[b.paymentState]
  }
}

/**
 * Whether a row has no meaningful value in the sorted column.
 *
 * Only `daysPastDue` has this problem, and it matters more than it looks. Every
 * invoice has a due date, so a *paid* invoice from ten months ago has a
 * `daysPastDue` of 300 — larger than any live debt. Sorting on the raw number
 * therefore fills the top of a "most overdue first" table with invoices that
 * were settled or cancelled long ago, pushing the actual problems below the
 * fold. Days past due is only meaningful when money is genuinely owed; for
 * everything else the cell is blank and the row sorts to the bottom.
 */
function hasNoSortValue(field: SortField, invoice: ScoredInvoice): boolean {
  return field === 'daysPastDue' && !invoice.isOverdue
}

/**
 * Sort into a new array, never in place.
 *
 * Two invariants:
 * - Rows with no value in the sorted column go last in *both* directions, the
 *   way blank cells conventionally behave. Flipping direction should not
 *   promote a wall of empty cells to the top.
 * - Ties break on invoice number, making the order *total*: without it, two
 *   invoices sharing a due date could swap places between renders and rows
 *   would appear to jitter as the user pages back and forth.
 */
export function sortInvoices(
  invoices: readonly ScoredInvoice[],
  sort: SortSpec,
): ScoredInvoice[] {
  const sign = sort.direction === 'asc' ? 1 : -1

  return [...invoices].sort((a, b) => {
    const aEmpty = hasNoSortValue(sort.field, a)
    const bEmpty = hasNoSortValue(sort.field, b)

    // Deliberately outside the `sign` multiplication: blanks stay at the
    // bottom whichever way the column is sorted.
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1

    if (!aEmpty) {
      const primary = compareBy(sort.field, a, b)
      if (primary !== 0) return primary * sign
    }
    return a.number.localeCompare(b.number, 'en', { numeric: true })
  })
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface Pagination {
  /** Clamped into `[1, pageCount]`. */
  readonly page: number
  readonly pageCount: number
  readonly pageSize: number
  readonly totalRows: number
  /** 1-based inclusive display range; both 0 when there are no rows. */
  readonly rangeStart: number
  readonly rangeEnd: number
}

/**
 * Work out the page window, tolerating an out-of-range `page`.
 *
 * This clamp is the fix for the classic data-table bug: you are on page 7, you
 * type into the search box, the result set shrinks to 2 pages, and the table
 * renders empty with no explanation. Deriving the page rather than trusting
 * stored state means that can't happen.
 */
export function paginate(totalRows: number, page: number, pageSize: number): Pagination {
  if (pageSize <= 0) throw new RangeError(`pageSize must be positive, got ${pageSize}`)

  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount)
  const firstIndex = (safePage - 1) * pageSize

  return {
    page: safePage,
    pageCount,
    pageSize,
    totalRows,
    rangeStart: totalRows === 0 ? 0 : firstIndex + 1,
    rangeEnd: Math.min(firstIndex + pageSize, totalRows),
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface Summary {
  readonly count: number
  readonly outstandingCents: number
  readonly overdueCount: number
  readonly overdueCents: number
  /** 0 when nothing is overdue. */
  readonly oldestDaysPastDue: number
  readonly worstSeverity: 0 | 1 | 2 | 3 | 4
}

export function summarise(invoices: readonly ScoredInvoice[]): Summary {
  let outstandingCents = 0
  let overdueCount = 0
  let overdueCents = 0
  let oldestDaysPastDue = 0
  let worstSeverity: 0 | 1 | 2 | 3 | 4 = 0

  for (const invoice of invoices) {
    outstandingCents += invoice.outstandingCents
    if (!invoice.isOverdue) continue

    overdueCount += 1
    overdueCents += invoice.outstandingCents
    oldestDaysPastDue = Math.max(oldestDaysPastDue, invoice.daysPastDue)
    const severity = severityFor(invoice)
    if (severity > worstSeverity) worstSeverity = severity
  }

  return {
    count: invoices.length,
    outstandingCents,
    overdueCount,
    overdueCents,
    oldestDaysPastDue,
    worstSeverity,
  }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface CustomerOption {
  readonly id: string
  readonly name: string
  readonly invoiceCount: number
}

export interface TableViewModel {
  /** Just the current page. */
  readonly rows: ScoredInvoice[]
  readonly pagination: Pagination
  /** Aggregates across the whole filtered set, not only the visible page. */
  readonly summary: Summary
  /** Row counts per segment, for the chip badges. */
  readonly viewCounts: Record<QuickView, number>
  readonly bucketCounts: Record<AgingBucket, number>
  readonly customers: CustomerOption[]
  readonly totalCount: number
}

function countViews(invoices: readonly ScoredInvoice[]): Record<QuickView, number> {
  const counts: Record<QuickView, number> = {
    all: invoices.length,
    overdue: 0,
    dueSoon: 0,
    open: 0,
    paid: 0,
    draft: 0,
    void: 0,
  }
  for (const invoice of invoices) counts[invoice.paymentState] += 1
  return counts
}

function countBuckets(
  invoices: readonly ScoredInvoice[],
): Record<AgingBucket, number> {
  const counts: Record<AgingBucket, number> = {
    current: 0,
    '1-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
  }
  for (const invoice of invoices) {
    if (invoice.isOverdue) counts[invoice.agingBucket] += 1
  }
  return counts
}

function listCustomers(invoices: readonly ScoredInvoice[]): CustomerOption[] {
  const byId = new Map<string, CustomerOption>()
  for (const invoice of invoices) {
    const existing = byId.get(invoice.customerId)
    byId.set(invoice.customerId, {
      id: invoice.customerId,
      name: invoice.customerName,
      invoiceCount: (existing?.invoiceCount ?? 0) + 1,
    })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/**
 * Filter, sort and paginate in one pass, plus everything the chrome needs.
 *
 * Facet counts are computed *before* the quick view is applied, so the badge on
 * each chip answers "how many would I get if I clicked this" rather than
 * collapsing to zero for every segment you are not currently on.
 */
export function buildTableViewModel(
  invoices: readonly ScoredInvoice[],
  query: TableQuery,
): TableViewModel {
  const facetBase = applyNonViewFilters(invoices, query)
  const filtered = filterInvoices(invoices, query)
  const sorted = sortInvoices(filtered, query.sort)
  const pagination = paginate(sorted.length, query.page, query.pageSize)
  const firstIndex = (pagination.page - 1) * pagination.pageSize

  return {
    rows: sorted.slice(firstIndex, firstIndex + pagination.pageSize),
    pagination,
    summary: summarise(filtered),
    viewCounts: countViews(facetBase),
    bucketCounts: countBuckets(facetBase),
    customers: listCustomers(invoices),
    totalCount: invoices.length,
  }
}
