import { useEffect, useMemo, useState } from 'react'
import { createFixtureInvoiceRepository } from './data/invoiceRepository.ts'
import { todayIsoDate } from './domain/dates.ts'
import type { Invoice } from './domain/invoice.ts'
import { InvoicesPage } from './features/invoices/InvoicesPage.tsx'

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly invoices: Invoice[] }
  | { readonly status: 'error'; readonly message: string }

export default function App() {
  // Resolved once per mount. Reading the clock during render would make the
  // component impure, and could tear across a midnight boundary mid-session
  // so that two rows disagreed about how overdue they were.
  const today = useMemo(() => todayIsoDate(), [])
  const repository = useMemo(() => createFixtureInvoiceRepository({ today }), [today])

  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    repository
      .listInvoices(controller.signal)
      .then((invoices) => {
        if (!controller.signal.aborted) setState({ status: 'ready', invoices })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      })

    // Aborting on unmount avoids a setState against an unmounted component
    // once this is a real network call rather than a fixture.
    return () => controller.abort()
  }, [repository])

  if (state.status === 'loading') {
    return (
      <main className="page">
        <p className="notice" role="status">
          Loading invoices…
        </p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="page">
        <p className="notice notice--error" role="alert">
          Could not load invoices: {state.message}
        </p>
      </main>
    )
  }

  return <InvoicesPage invoices={state.invoices} today={today} />
}
