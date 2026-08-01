/**
 * Component tests for the page.
 *
 * These deliberately do not re-test the filter/sort/paginate maths — that is
 * covered exhaustively against the pure functions in `tableModel.test.ts`.
 * What they prove is the wiring: that a click reaches the reducer, that the
 * derived numbers reach the DOM, and that the accessibility contract (aria-sort,
 * aria-pressed, the live region) is actually emitted.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { generateInvoices } from '../../data/generateInvoices.ts'
import { scoreInvoices } from '../../domain/aging.ts'
import { InvoicesPage } from './InvoicesPage.tsx'

const TODAY = '2026-08-01'
const INVOICES = generateInvoices({ today: TODAY })
const SCORED = scoreInvoices(INVOICES, TODAY)
const OVERDUE_COUNT = SCORED.filter((i) => i.isOverdue).length

function renderPage() {
  return render(<InvoicesPage invoices={INVOICES} today={TODAY} />)
}

/** Data rows only, excluding the header row. */
function dataRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

function columnHeader(name: string) {
  return screen.getByRole('columnheader', { name: new RegExp(name, 'i') })
}

let user: ReturnType<typeof userEvent.setup>

beforeEach(() => {
  user = userEvent.setup()
})

describe('initial render', () => {
  it('shows the dataset size and reference date', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeInTheDocument()
    expect(screen.getByText('200 invoices · as of 1 August 2026')).toBeInTheDocument()
  })

  it('states the overdue count up front, without the user filtering', () => {
    renderPage()
    const tile = screen.getByRole('button', { name: /^Show only overdue invoices/ })
    expect(within(tile).getByText(String(OVERDUE_COUNT))).toBeInTheDocument()
  })

  it('renders the first page of 25 rows', () => {
    renderPage()
    expect(dataRows()).toHaveLength(25)
    expect(screen.getByText('Showing 1–25 of 200')).toBeInTheDocument()
  })

  it('sorts most-overdue-first by default, so the worst debt is row one', () => {
    renderPage()
    // The single most important behaviour of this view: no interaction needed.
    expect(columnHeader('Days late')).toHaveAttribute('aria-sort', 'descending')

    const worst = Math.max(...SCORED.filter((i) => i.isOverdue).map((i) => i.daysPastDue))
    const firstRow = dataRows()[0]!
    expect(within(firstRow).getByText(`${worst} days`)).toBeInTheDocument()
  })

  it('puts every overdue invoice above every non-overdue one', () => {
    renderPage()
    const badges = dataRows().map(
      (row) => within(row).getByText(/^(Overdue|Due soon|Open|Paid|Draft|Void)$/).textContent,
    )
    const lastOverdue = badges.lastIndexOf('Overdue')
    const firstOther = badges.findIndex((badge) => badge !== 'Overdue')
    if (firstOther !== -1 && lastOverdue !== -1) {
      expect(lastOverdue).toBeLessThan(firstOther)
    }
  })
})

describe('quick view chips', () => {
  it('filters to overdue and reports the state accessibly', async () => {
    renderPage()
    const chip = screen.getByRole('button', { name: `Overdue, ${OVERDUE_COUNT} invoices` })
    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(dataRows()).toHaveLength(Math.min(25, OVERDUE_COUNT))
    for (const row of dataRows()) {
      expect(within(row).getByText('Overdue')).toBeInTheDocument()
    }
  })

  it('keeps the other chip counts intact after filtering', async () => {
    renderPage()
    const paidChip = screen.getByRole('button', { name: /^Paid, \d+ invoices$/ })
    const paidLabel = paidChip.textContent
    await user.click(screen.getByRole('button', { name: /^Overdue, \d+ invoices$/ }))
    // Facet counts answer "what would I get", so they must not collapse to 0.
    expect(screen.getByRole('button', { name: /^Paid, \d+ invoices$/ }).textContent).toBe(paidLabel)
  })

  it('shows only paid invoices, none of them overdue', async () => {
    renderPage()
    await user.click(screen.getByRole('button', { name: /^Paid, \d+ invoices$/ }))
    for (const row of dataRows()) {
      expect(within(row).getByText('Paid')).toBeInTheDocument()
      expect(within(row).getByText('Not overdue')).toBeInTheDocument()
    }
  })
})

describe('the overdue summary tile', () => {
  it('acts as a shortcut to the overdue subset', async () => {
    renderPage()
    const tile = screen.getByRole('button', { name: /^Show only overdue invoices/ })
    expect(tile).toHaveAttribute('aria-pressed', 'false')

    await user.click(tile)

    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Overdue, \d+ invoices$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('toggles back off on a second click', async () => {
    renderPage()
    const tile = screen.getByRole('button', { name: /^Show only overdue invoices/ })
    await user.click(tile)
    await user.click(tile)
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Showing 1–25 of 200')).toBeInTheDocument()
  })
})

describe('search', () => {
  it('narrows by customer name', async () => {
    renderPage()
    await user.type(screen.getByLabelText('Search'), 'northwind')

    const rows = dataRows()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(within(row).getByText(/Northwind/i)).toBeInTheDocument()
    }
  })

  it('narrows by invoice number', async () => {
    const target = INVOICES[0]!
    renderPage()
    await user.type(screen.getByLabelText('Search'), target.number)
    expect(dataRows()).toHaveLength(1)
    expect(screen.getByRole('rowheader', { name: target.number })).toBeInTheDocument()
  })

  it('shows an explanatory empty state, not a blank table', async () => {
    renderPage()
    await user.type(screen.getByLabelText('Search'), 'definitely-no-such-customer')

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('No invoices match these filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('recovers from the empty state via Clear filters', async () => {
    renderPage()
    await user.type(screen.getByLabelText('Search'), 'zzzzz')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Showing 1–25 of 200')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toHaveValue('')
  })
})

describe('sorting', () => {
  it('flips direction when the active column is clicked again', async () => {
    renderPage()
    const header = columnHeader('Days late')
    expect(header).toHaveAttribute('aria-sort', 'descending')

    await user.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')

    await user.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'descending')
  })

  it('moves the sort to a new column and clears it from the old one', async () => {
    renderPage()
    await user.click(within(columnHeader('Amount')).getByRole('button'))

    expect(columnHeader('Amount')).toHaveAttribute('aria-sort', 'descending')
    expect(columnHeader('Days late')).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts amounts largest-first and actually reorders the rows', async () => {
    renderPage()
    await user.click(within(columnHeader('Amount')).getByRole('button'))

    const amounts = dataRows().map((row) => {
      const text = row.querySelector('.cell-amount')?.textContent ?? '0'
      return Number(text.replace(/[$,]/g, ''))
    })
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a))
  })

  it('starts a text column ascending', async () => {
    renderPage()
    await user.click(within(columnHeader('Customer')).getByRole('button'))
    expect(columnHeader('Customer')).toHaveAttribute('aria-sort', 'ascending')
  })
})

describe('pagination', () => {
  it('moves to the next page and updates the range', async () => {
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('Showing 26–50 of 200')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('disables Previous on the first page and Next on the last', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Page 8' }))
    expect(screen.getByText('Showing 176–200 of 200')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('changes the page size and recalculates the range', async () => {
    renderPage()
    await user.selectOptions(screen.getByLabelText('Rows per page'), '100')

    expect(dataRows()).toHaveLength(100)
    expect(screen.getByText('Showing 1–100 of 200')).toBeInTheDocument()
  })

  it('returns to page 1 when a filter changes, rather than showing a blank page', async () => {
    renderPage()
    // Page 8 rather than 7: the paginator elides the middle, so from page 1 the
    // only deep page actually on screen is the last one.
    await user.click(screen.getByRole('button', { name: 'Page 8' }))
    expect(screen.getByText('Showing 176–200 of 200')).toBeInTheDocument()

    // Filtering to ~28 overdue invoices means page 8 no longer exists.
    await user.click(screen.getByRole('button', { name: /^Overdue, \d+ invoices$/ }))
    expect(screen.getByText(`Showing 1–25 of ${OVERDUE_COUNT}`)).toBeInTheDocument()
    expect(dataRows().length).toBeGreaterThan(0)
  })

  it('does NOT reset the page when only the sort changes', async () => {
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Page 3' }))
    await user.click(within(columnHeader('Amount')).getByRole('button'))
    // Reordering the same rows should not eject the user from their position.
    expect(screen.getByText('Showing 51–75 of 200')).toBeInTheDocument()
  })

  it('announces the result count in a live region', () => {
    renderPage()
    const status = screen.getByText('Showing 1–25 of 200')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})

describe('aging bucket filters', () => {
  it('filters to a single aging band', async () => {
    renderPage()
    const bucket = screen.getByRole('button', { name: /^31-60 days overdue, \d+ invoices$/ })
    await user.click(bucket)

    expect(bucket).toHaveAttribute('aria-pressed', 'true')
    for (const row of dataRows()) {
      expect(within(row).getByText('Overdue')).toBeInTheDocument()
      const days = Number(
        /(\d+) days?/.exec(row.querySelector('.days-late')?.textContent ?? '')?.[1],
      )
      expect(days).toBeGreaterThanOrEqual(31)
      expect(days).toBeLessThanOrEqual(60)
    }
  })

  it('combines two bands as a union', async () => {
    renderPage()
    await user.click(screen.getByRole('button', { name: /^1-30 days overdue, \d+ invoices$/ }))
    const firstCount = dataRows().length
    await user.click(screen.getByRole('button', { name: /^61-90 days overdue, \d+ invoices$/ }))
    expect(dataRows().length).toBeGreaterThan(firstCount)
  })

  it('hides the aging controls for views where lateness is meaningless', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: /^1-30 days overdue, \d+ invoices$/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Paid, \d+ invoices$/ }))
    // Offering "31-60 days late" alongside "Paid" would guarantee 0 results.
    expect(screen.queryByRole('button', { name: /^1-30 days overdue, \d+ invoices$/ })).not.toBeInTheDocument()
  })

  it('drops a stale aging filter when switching to an incompatible view', async () => {
    renderPage()
    await user.click(screen.getByRole('button', { name: /^31-60 days overdue, \d+ invoices$/ }))
    await user.click(screen.getByRole('button', { name: /^Paid, \d+ invoices$/ }))

    // Should show paid invoices, not an empty table.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(dataRows().length).toBeGreaterThan(0)
  })
})

describe('customer filter', () => {
  it('narrows to one customer', async () => {
    renderPage()
    const select = screen.getByLabelText('Customer')
    const option = within(select).getAllByRole('option')[1]!
    await user.selectOptions(select, option)

    const name = option.textContent!.replace(/\s*\(\d+\)$/, '')
    for (const row of dataRows()) {
      expect(within(row).getByText(name)).toBeInTheDocument()
    }
  })
})

describe('accessibility contract', () => {
  it('gives the table a caption describing the current sort', () => {
    renderPage()
    expect(screen.getByRole('table')).toHaveAccessibleName(/sorted by Days late/i)
  })

  it('uses row headers so each row is identified by its invoice number', () => {
    renderPage()
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(25)
  })

  it('never conveys overdue severity by colour alone', () => {
    renderPage()
    // Each severity-coloured cell also carries the day count and the word "late".
    for (const cell of document.querySelectorAll('.days-late')) {
      expect(cell.textContent).toMatch(/\d+ days? late/)
    }
  })
})
