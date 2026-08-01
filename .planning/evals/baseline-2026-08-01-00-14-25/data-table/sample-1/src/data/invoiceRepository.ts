/**
 * The seam between the table and wherever invoices really live.
 *
 * The interface is async even though the fixture is synchronous. That is the
 * point: swapping in a real endpoint later becomes a new implementation of this
 * interface rather than a change to the components, and the UI is forced to
 * handle loading and error states from day one instead of having them retrofitted
 * once a network is involved.
 */

import type { Invoice, IsoDate } from '../domain/invoice.ts'
import { generateInvoices } from './generateInvoices.ts'

export interface InvoiceRepository {
  /**
   * All invoices for the current account.
   *
   * Returning the full set is a deliberate call for this view: 200 rows is a
   * few tens of KB, so filtering and sorting locally makes every interaction
   * instant. If this grows past a few thousand rows, this is the method that
   * gains `{ filter, sort, page }` parameters and the work moves server-side.
   */
  listInvoices(signal?: AbortSignal): Promise<Invoice[]>
}

export interface FixtureRepositoryOptions {
  readonly today: IsoDate
  readonly count?: number
  readonly seed?: number
  /** Artificial latency in ms, for exercising the loading state by hand. */
  readonly delayMs?: number
}

export function createFixtureInvoiceRepository(
  options: FixtureRepositoryOptions,
): InvoiceRepository {
  const { delayMs = 0, ...generateOptions } = options

  return {
    async listInvoices(signal) {
      if (delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
          })
        })
      }
      signal?.throwIfAborted()
      return generateInvoices(generateOptions)
    },
  }
}
