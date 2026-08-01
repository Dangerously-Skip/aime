import { useMemo } from 'react'
import { scoreInvoices } from '../../domain/aging.ts'
import type { Invoice, IsoDate } from '../../domain/invoice.ts'
import { formatCount, formatDateLong } from '../../lib/format.ts'
import { InvoiceTable } from './components/InvoiceTable.tsx'
import { SummaryBar } from './components/SummaryBar.tsx'
import { TablePagination } from './components/TablePagination.tsx'
import { Toolbar } from './components/Toolbar.tsx'
import type { TableQuery } from './tableModel.ts'
import { useInvoiceTable } from './useInvoiceTable.ts'

interface InvoicesPageProps {
  readonly invoices: readonly Invoice[]
  /** Injected rather than read from the clock, so the view is deterministic. */
  readonly today: IsoDate
  readonly initialQuery?: Partial<TableQuery>
}

export function InvoicesPage({ invoices, today, initialQuery }: InvoicesPageProps) {
  // Scoring is O(n) and depends only on the data and the date, so it happens
  // once here rather than inside each render of each row.
  const scored = useMemo(() => scoreInvoices(invoices, today), [invoices, today])
  const table = useInvoiceTable(scored, initialQuery)
  const { model, query } = table

  return (
    <main className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Invoices</h1>
          <p className="page__subtitle">
            {formatCount(model.totalCount, 'invoice')} · as of {formatDateLong(today)}
          </p>
        </div>
      </header>

      <SummaryBar
        summary={model.summary}
        isShowingOverdue={query.view === 'overdue'}
        onShowOverdue={() => table.setView(query.view === 'overdue' ? 'all' : 'overdue')}
      />

      <Toolbar
        search={query.search}
        view={query.view}
        activeBuckets={query.agingBuckets}
        customerId={query.customerId}
        viewCounts={model.viewCounts}
        bucketCounts={model.bucketCounts}
        customers={model.customers}
        isFiltered={table.isFiltered}
        onSearch={table.setSearch}
        onView={table.setView}
        onToggleBucket={table.toggleBucket}
        onCustomer={table.setCustomer}
        onReset={table.reset}
      />

      <InvoiceTable
        rows={model.rows}
        sort={query.sort}
        onSort={table.toggleSort}
        isFiltered={table.isFiltered}
        onReset={table.reset}
      />

      {model.rows.length > 0 && (
        <TablePagination
          pagination={model.pagination}
          onPage={table.setPage}
          onPageSize={table.setPageSize}
        />
      )}
    </main>
  )
}
