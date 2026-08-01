import { describe, expect, it } from 'vitest'
import { scoreInvoices } from '../../domain/aging.ts'
import type { Invoice, ScoredInvoice } from '../../domain/invoice.ts'
import { generateInvoices } from '../../data/generateInvoices.ts'
import {
  buildTableViewModel,
  DEFAULT_QUERY,
  DEFAULT_SORT,
  defaultDirectionFor,
  filterInvoices,
  matchesSearch,
  normaliseForSearch,
  paginate,
  sortInvoices,
  summarise,
  type TableQuery,
} from './tableModel.ts'

const TODAY = '2026-08-01'

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: overrides.id ?? 'inv_x',
    number: 'INV-1000',
    customerId: 'cus_001',
    customerName: 'Northwind Traders',
    issueDate: '2026-07-01',
    dueDate: '2026-07-31',
    amountCents: 100_00,
    currency: 'USD',
    status: 'sent',
    paidDate: null,
    ...overrides,
  }
}

function scored(overrides: Partial<Invoice>): ScoredInvoice {
  return scoreInvoices([invoice(overrides)], TODAY)[0]!
}

function query(overrides: Partial<TableQuery> = {}): TableQuery {
  return { ...DEFAULT_QUERY, ...overrides }
}

/** A small, fully controlled fixture where every expected count is hand-checked. */
const FIXTURE: ScoredInvoice[] = scoreInvoices(
  [
    invoice({ id: 'a', number: 'INV-1001', dueDate: '2026-01-15', amountCents: 900_00 }), // overdue 198d, 90+
    invoice({ id: 'b', number: 'INV-1002', dueDate: '2026-06-20', amountCents: 100_00 }), // overdue 42d, 31-60
    invoice({ id: 'c', number: 'INV-1003', dueDate: '2026-07-25', amountCents: 250_00 }), // overdue 7d, 1-30
    invoice({ id: 'd', number: 'INV-1004', dueDate: '2026-08-05', amountCents: 300_00 }), // dueSoon
    invoice({ id: 'e', number: 'INV-1005', dueDate: '2026-10-01', amountCents: 400_00 }), // open
    invoice({
      id: 'f',
      number: 'INV-1006',
      dueDate: '2026-05-01',
      status: 'paid',
      paidDate: '2026-05-02',
      amountCents: 500_00,
    }),
    invoice({ id: 'g', number: 'INV-1007', dueDate: '2026-09-01', status: 'draft', amountCents: 600_00 }),
    invoice({ id: 'h', number: 'INV-1008', dueDate: '2026-03-01', status: 'void', amountCents: 700_00 }),
    invoice({
      id: 'i',
      number: 'INV-1009',
      customerId: 'cus_002',
      customerName: 'Margie’s Travel',
      dueDate: '2026-07-01',
      amountCents: 800_00,
    }), // overdue 31d, 31-60
  ],
  TODAY,
)

describe('normaliseForSearch', () => {
  it('folds case, accents, curly apostrophes and dashes', () => {
    expect(normaliseForSearch('  Café ')).toBe('cafe')
    expect(normaliseForSearch('Margie’s')).toBe("margie's")
    expect(normaliseForSearch('A—B')).toBe('a-b')
  })
})

describe('matchesSearch', () => {
  const target = scored({ number: 'INV-1042', customerName: 'Northwind Traders' })

  it('matches on invoice number, partially and case-insensitively', () => {
    expect(matchesSearch(target, '1042')).toBe(true)
    expect(matchesSearch(target, 'inv-1042')).toBe(true)
    expect(matchesSearch(target, 'INV')).toBe(true)
  })

  it('matches on customer name', () => {
    expect(matchesSearch(target, 'northwind')).toBe(true)
    expect(matchesSearch(target, 'TRADERS')).toBe(true)
  })

  it('treats an empty or whitespace query as matching everything', () => {
    expect(matchesSearch(target, '')).toBe(true)
    expect(matchesSearch(target, '   ')).toBe(true)
  })

  it('requires every term to match, so extra words narrow the result', () => {
    expect(matchesSearch(target, 'north 1042')).toBe(true)
    expect(matchesSearch(target, 'north 9999')).toBe(false)
  })

  it('finds a name typed with a straight apostrophe', () => {
    // The fixture name uses U+2019; users type U+0027.
    const curly = scored({ customerName: 'Margie’s Travel' })
    expect(matchesSearch(curly, "margie's")).toBe(true)
  })

  it('rejects a non-match', () => {
    expect(matchesSearch(target, 'contoso')).toBe(false)
  })
})

describe('filterInvoices', () => {
  it('returns everything for the default query', () => {
    expect(filterInvoices(FIXTURE, query())).toHaveLength(FIXTURE.length)
  })

  it('narrows to overdue only', () => {
    const result = filterInvoices(FIXTURE, query({ view: 'overdue' }))
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c', 'i'])
  })

  it.each([
    ['dueSoon', ['d']],
    ['paid', ['f']],
    ['draft', ['g']],
    ['void', ['h']],
    ['open', ['e']],
  ] as const)('narrows to %s', (view, expected) => {
    expect(filterInvoices(FIXTURE, query({ view })).map((i) => i.id)).toEqual(expected)
  })

  it('filters by aging bucket, implying overdue', () => {
    expect(
      filterInvoices(FIXTURE, query({ agingBuckets: ['31-60'] })).map((i) => i.id),
    ).toEqual(['b', 'i'])
  })

  it('accepts multiple aging buckets', () => {
    expect(
      filterInvoices(FIXTURE, query({ agingBuckets: ['1-30', '90+'] })).map((i) => i.id),
    ).toEqual(['a', 'c'])
  })

  it('never returns a paid invoice from an aging filter, however old', () => {
    const result = filterInvoices(
      FIXTURE,
      query({ agingBuckets: ['1-30', '31-60', '61-90', '90+'] }),
    )
    expect(result.every((i) => i.isOverdue)).toBe(true)
  })

  it('filters by customer', () => {
    expect(
      filterInvoices(FIXTURE, query({ customerId: 'cus_002' })).map((i) => i.id),
    ).toEqual(['i'])
  })

  it('combines search, view and customer as AND', () => {
    const result = filterInvoices(
      FIXTURE,
      query({ view: 'overdue', customerId: 'cus_001', search: '1002' }),
    )
    expect(result.map((i) => i.id)).toEqual(['b'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterInvoices(FIXTURE, query({ search: 'nothing-matches-this' }))).toEqual([])
  })
})

describe('sortInvoices', () => {
  it('does not mutate its input', () => {
    const before = FIXTURE.map((i) => i.id)
    sortInvoices(FIXTURE, { field: 'amountCents', direction: 'asc' })
    expect(FIXTURE.map((i) => i.id)).toEqual(before)
  })

  it('sorts most-overdue-first by default', () => {
    const result = sortInvoices(FIXTURE, DEFAULT_SORT)
    // a=198d, i=31d, b=42d, c=7d are the only real debts.
    expect(result.slice(0, 4).map((i) => i.id)).toEqual(['a', 'b', 'i', 'c'])
    expect(result.slice(0, 4).every((i) => i.isOverdue)).toBe(true)
  })

  it('ranks live debt above settled invoices that are older', () => {
    // The void invoice h fell due 153 days ago and the paid invoice f 92 days
    // ago — both "older" than the 7-day-late invoice c, but nothing is owed on
    // them, so they must not outrank a real debt in a most-overdue-first view.
    const result = sortInvoices(FIXTURE, DEFAULT_SORT)
    const positionOf = (id: string) => result.findIndex((i) => i.id === id)
    expect(positionOf('c')).toBeLessThan(positionOf('h'))
    expect(positionOf('c')).toBeLessThan(positionOf('f'))
  })

  it('keeps rows with no days-past-due value last in BOTH directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      const result = sortInvoices(FIXTURE, { field: 'daysPastDue', direction })
      const firstBlank = result.findIndex((i) => !i.isOverdue)
      // Once the blanks start, no overdue row may appear again.
      expect(result.slice(firstBlank).some((i) => i.isOverdue)).toBe(false)
    }
  })

  it('sorts least-overdue-first when ascending', () => {
    const result = sortInvoices(FIXTURE, { field: 'daysPastDue', direction: 'asc' })
    expect(result.slice(0, 4).map((i) => i.id)).toEqual(['c', 'i', 'b', 'a'])
  })

  it('reverses cleanly', () => {
    const desc = sortInvoices(FIXTURE, { field: 'amountCents', direction: 'desc' })
    const asc = sortInvoices(FIXTURE, { field: 'amountCents', direction: 'asc' })
    expect(desc.map((i) => i.id)).toEqual([...asc].reverse().map((i) => i.id))
  })

  it('sorts invoice numbers numerically, not lexically', () => {
    const set = scoreInvoices(
      [
        invoice({ id: '9', number: 'INV-9' }),
        invoice({ id: '10', number: 'INV-10' }),
        invoice({ id: '100', number: 'INV-100' }),
      ],
      TODAY,
    )
    expect(
      sortInvoices(set, { field: 'number', direction: 'asc' }).map((i) => i.number),
    ).toEqual(['INV-9', 'INV-10', 'INV-100'])
  })

  it('orders payment state by urgency, not alphabetically', () => {
    const result = sortInvoices(FIXTURE, { field: 'paymentState', direction: 'desc' })
    expect(result[0]!.paymentState).toBe('overdue')
    expect(result.at(-1)!.paymentState).toBe('void')
  })

  it('breaks ties deterministically by invoice number', () => {
    const tied = scoreInvoices(
      [
        invoice({ id: 'z', number: 'INV-2002', dueDate: '2026-07-01' }),
        invoice({ id: 'y', number: 'INV-2001', dueDate: '2026-07-01' }),
      ],
      TODAY,
    )
    const once = sortInvoices(tied, DEFAULT_SORT).map((i) => i.number)
    const twice = sortInvoices([...tied].reverse(), DEFAULT_SORT).map((i) => i.number)
    expect(once).toEqual(['INV-2001', 'INV-2002'])
    // Same result regardless of incoming order: the order is total.
    expect(twice).toEqual(once)
  })

  it('sorts by customer name case-insensitively', () => {
    const set = scoreInvoices(
      [
        invoice({ id: '1', number: 'INV-1', customerName: 'zebra corp' }),
        invoice({ id: '2', number: 'INV-2', customerName: 'Apple Ltd' }),
      ],
      TODAY,
    )
    expect(
      sortInvoices(set, { field: 'customerName', direction: 'asc' }).map(
        (i) => i.customerName,
      ),
    ).toEqual(['Apple Ltd', 'zebra corp'])
  })

  it('handles empty and single-item input', () => {
    expect(sortInvoices([], DEFAULT_SORT)).toEqual([])
    expect(sortInvoices([FIXTURE[0]!], DEFAULT_SORT)).toHaveLength(1)
  })
})

describe('defaultDirectionFor', () => {
  it('starts text ascending and magnitudes descending', () => {
    expect(defaultDirectionFor('customerName')).toBe('asc')
    expect(defaultDirectionFor('number')).toBe('asc')
    expect(defaultDirectionFor('amountCents')).toBe('desc')
    expect(defaultDirectionFor('daysPastDue')).toBe('desc')
  })
})

describe('paginate', () => {
  it('describes a normal middle page', () => {
    expect(paginate(200, 3, 25)).toMatchObject({
      page: 3,
      pageCount: 8,
      rangeStart: 51,
      rangeEnd: 75,
    })
  })

  it('handles a partial final page', () => {
    expect(paginate(203, 9, 25)).toMatchObject({
      page: 9,
      pageCount: 9,
      rangeStart: 201,
      rangeEnd: 203,
    })
  })

  it('clamps a page beyond the end', () => {
    // The bug this prevents: filter shrinks the set while you are on page 7
    // and the table renders blank.
    expect(paginate(30, 99, 25)).toMatchObject({ page: 2, rangeStart: 26, rangeEnd: 30 })
  })

  it('clamps a page below the start', () => {
    expect(paginate(30, 0, 25).page).toBe(1)
    expect(paginate(30, -5, 25).page).toBe(1)
  })

  it('reports an empty range for no rows but still one page', () => {
    expect(paginate(0, 1, 25)).toMatchObject({
      page: 1,
      pageCount: 1,
      rangeStart: 0,
      rangeEnd: 0,
    })
  })

  it('handles exactly one full page', () => {
    expect(paginate(25, 1, 25)).toMatchObject({ pageCount: 1, rangeEnd: 25 })
  })

  it('truncates a fractional page number', () => {
    expect(paginate(200, 2.7, 25).page).toBe(2)
  })

  it('rejects a non-positive page size', () => {
    expect(() => paginate(10, 1, 0)).toThrow(RangeError)
    expect(() => paginate(10, 1, -25)).toThrow(RangeError)
  })
})

describe('summarise', () => {
  it('totals outstanding across unpaid invoices only', () => {
    // sent: a 900 + b 100 + c 250 + d 300 + e 400 + i 800 = 2750; paid/draft/void excluded
    expect(summarise(FIXTURE).outstandingCents).toBe(2_750_00)
  })

  it('counts and totals the overdue subset', () => {
    const summary = summarise(FIXTURE)
    expect(summary.overdueCount).toBe(4)
    expect(summary.overdueCents).toBe(900_00 + 100_00 + 250_00 + 800_00)
  })

  it('reports the oldest debt and worst severity', () => {
    const summary = summarise(FIXTURE)
    expect(summary.oldestDaysPastDue).toBe(198)
    expect(summary.worstSeverity).toBe(4)
  })

  it('is all zeroes for an empty set', () => {
    expect(summarise([])).toEqual({
      count: 0,
      outstandingCents: 0,
      overdueCount: 0,
      overdueCents: 0,
      oldestDaysPastDue: 0,
      worstSeverity: 0,
    })
  })

  it('reports no overdue debt when nothing is late', () => {
    const summary = summarise(filterInvoices(FIXTURE, query({ view: 'paid' })))
    expect(summary.overdueCount).toBe(0)
    expect(summary.oldestDaysPastDue).toBe(0)
    expect(summary.worstSeverity).toBe(0)
  })

  it('sums money exactly, with no floating-point drift', () => {
    // Integer cents make this exact; floats would give 0.30000000000000004.
    const cents = scoreInvoices(
      [
        invoice({ id: '1', number: 'INV-1', amountCents: 10 }),
        invoice({ id: '2', number: 'INV-2', amountCents: 20 }),
      ],
      TODAY,
    )
    expect(summarise(cents).outstandingCents).toBe(30)
  })
})

describe('buildTableViewModel', () => {
  it('returns only the current page of rows', () => {
    const vm = buildTableViewModel(FIXTURE, query({ pageSize: 10 }))
    expect(vm.rows).toHaveLength(9)
    const paged = buildTableViewModel(FIXTURE, query({ pageSize: 25, page: 1 }))
    expect(paged.pagination.pageCount).toBe(1)
  })

  it('returns rows in the sorted order on the first page', () => {
    const sorted = sortInvoices(FIXTURE, DEFAULT_SORT)
    const vm = buildTableViewModel(FIXTURE, query({ pageSize: 10 }))
    expect(vm.rows.map((r) => r.id)).toEqual(sorted.map((r) => r.id))
  })

  it('summarises the whole filtered set, not just the visible page', () => {
    const vm = buildTableViewModel(FIXTURE, query({ pageSize: 10 }))
    const onePerPage = buildTableViewModel(FIXTURE, query({ pageSize: 10, page: 1 }))
    expect(onePerPage.summary.outstandingCents).toBe(vm.summary.outstandingCents)

    const tiny = buildTableViewModel(FIXTURE, query({ pageSize: 10 }))
    expect(tiny.summary.count).toBe(FIXTURE.length)
  })

  it('counts facets independently of the active view', () => {
    // Clicking a chip must not zero out the other badges.
    const onAll = buildTableViewModel(FIXTURE, query({ view: 'all' }))
    const onPaid = buildTableViewModel(FIXTURE, query({ view: 'paid' }))
    expect(onPaid.viewCounts).toEqual(onAll.viewCounts)
    expect(onPaid.viewCounts.overdue).toBe(4)
  })

  it('does narrow facet counts by search and customer', () => {
    const vm = buildTableViewModel(FIXTURE, query({ customerId: 'cus_002' }))
    expect(vm.viewCounts.all).toBe(1)
    expect(vm.viewCounts.overdue).toBe(1)
    expect(vm.viewCounts.paid).toBe(0)
  })

  it('exposes aging bucket counts for the overdue subset', () => {
    const vm = buildTableViewModel(FIXTURE, query())
    expect(vm.bucketCounts).toEqual({
      current: 0,
      '1-30': 1,
      '31-60': 2,
      '61-90': 0,
      '90+': 1,
    })
  })

  it('lists customers alphabetically with invoice counts, from the full set', () => {
    const vm = buildTableViewModel(FIXTURE, query({ view: 'paid' }))
    expect(vm.customers.map((c) => c.name)).toEqual([
      'Margie’s Travel',
      'Northwind Traders',
    ])
    expect(vm.customers.find((c) => c.id === 'cus_001')?.invoiceCount).toBe(8)
  })

  it('reports the unfiltered total alongside the filtered count', () => {
    const vm = buildTableViewModel(FIXTURE, query({ view: 'overdue' }))
    expect(vm.totalCount).toBe(9)
    expect(vm.pagination.totalRows).toBe(4)
  })

  it('yields a coherent empty state', () => {
    const vm = buildTableViewModel(FIXTURE, query({ search: 'zzzz' }))
    expect(vm.rows).toEqual([])
    expect(vm.pagination).toMatchObject({ page: 1, pageCount: 1, rangeStart: 0, rangeEnd: 0 })
    expect(vm.summary.count).toBe(0)
    // Customer list still populated, so the user can undo the filter.
    expect(vm.customers.length).toBeGreaterThan(0)
  })

  it('recovers when a filter strands the user past the last page', () => {
    const vm = buildTableViewModel(
      FIXTURE,
      query({ view: 'overdue', pageSize: 10, page: 5 }),
    )
    expect(vm.pagination.page).toBe(1)
    expect(vm.rows).toHaveLength(4)
  })
})

describe('buildTableViewModel against the full 200-invoice dataset', () => {
  const all = scoreInvoices(generateInvoices({ today: TODAY }), TODAY)

  it('paginates 200 rows into 8 pages of 25', () => {
    const vm = buildTableViewModel(all, query())
    expect(vm.pagination.pageCount).toBe(8)
    expect(vm.rows).toHaveLength(25)
    expect(vm.totalCount).toBe(200)
  })

  it('slices the correct window on a later page', () => {
    const sorted = sortInvoices(all, DEFAULT_SORT)
    const page3 = buildTableViewModel(all, query({ pageSize: 25, page: 3 }))
    expect(page3.rows.map((r) => r.id)).toEqual(sorted.slice(50, 75).map((r) => r.id))
    expect(page3.pagination).toMatchObject({ rangeStart: 51, rangeEnd: 75 })
  })

  it('puts the single most overdue invoice in the first row by default', () => {
    const vm = buildTableViewModel(all, query())
    const worst = Math.max(...all.filter((i) => i.isOverdue).map((i) => i.daysPastDue))
    expect(vm.rows[0]!.daysPastDue).toBe(worst)
    expect(vm.rows[0]!.isOverdue).toBe(true)
  })

  it('visits every row exactly once when paging through', () => {
    const seen: string[] = []
    const pageCount = buildTableViewModel(all, query()).pagination.pageCount
    for (let page = 1; page <= pageCount; page += 1) {
      seen.push(...buildTableViewModel(all, query({ page })).rows.map((r) => r.id))
    }
    expect(seen).toHaveLength(200)
    expect(new Set(seen).size).toBe(200)
  })

  it('keeps every page full except possibly the last, at each page size', () => {
    for (const pageSize of [10, 25, 50, 100] as const) {
      const vm = buildTableViewModel(all, query({ pageSize }))
      expect(vm.rows).toHaveLength(pageSize)
      expect(vm.pagination.pageCount).toBe(Math.ceil(200 / pageSize))
    }
  })

  it('agrees between the overdue chip count and the overdue view', () => {
    const vm = buildTableViewModel(all, query())
    const overdueView = buildTableViewModel(all, query({ view: 'overdue' }))
    expect(overdueView.pagination.totalRows).toBe(vm.viewCounts.overdue)
    expect(overdueView.summary.overdueCount).toBe(vm.viewCounts.overdue)
  })

  it('has chip counts that sum to the total', () => {
    const { viewCounts } = buildTableViewModel(all, query())
    const sum =
      viewCounts.overdue +
      viewCounts.dueSoon +
      viewCounts.open +
      viewCounts.paid +
      viewCounts.draft +
      viewCounts.void
    expect(sum).toBe(viewCounts.all)
    expect(sum).toBe(200)
  })
})
