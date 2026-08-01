import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end happy path for the job this page exists to serve: a user opens it
 * to find out which invoices are overdue, and how bad the worst of them is.
 *
 * These tests run against the real app, which reads the real clock — so the
 * dataset is regenerated relative to whatever today happens to be. Nothing here
 * hardcodes a count or a date. What is asserted are the invariants that must
 * hold on any day: the overdue figure is stated up front, the worst debt is at
 * the top without anyone touching a control, and filtering/sorting/paging keep
 * the table and its status line in agreement.
 */

const STATUS = /^Showing (\d+)–(\d+) of ([\d,]+)$/

/** Parse the live-region status line into numbers so ranges can be checked. */
async function readStatus(page: Page) {
  const text = (await page.getByText(STATUS).innerText()).trim()
  const match = STATUS.exec(text)
  if (match === null) throw new Error(`Unexpected status line: ${text}`)
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]!.replace(/,/g, '')),
  }
}

function dataRows(page: Page) {
  return page.locator('table tbody tr')
}

/** The day count from a row's "Days late" cell, or null when not overdue. */
async function daysLateAt(page: Page, index: number): Promise<number | null> {
  const text = await dataRows(page).nth(index).locator('.days-late').innerText()
  const match = /(\d+)\s*days?/.exec(text)
  return match === null ? null : Number(match[1])
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  // The fixture loads asynchronously; wait for the table rather than a timeout.
  await expect(page.getByRole('table')).toBeVisible()
})

test('states the overdue position before the user touches anything', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible()
  await expect(page.getByText(/^200 invoices · as of /)).toBeVisible()

  const tile = page.getByRole('button', { name: /^Show only overdue invoices/ })
  await expect(tile).toBeVisible()

  // The count is legible from the tile itself, not buried in the table.
  const label = await tile.getAttribute('aria-label')
  expect(label).toMatch(/^Show only overdue invoices: \d+ totalling \$[\d,]+\.\d{2}$/)
})

test('opens sorted most-overdue-first, so the worst debt needs no interaction', async ({
  page,
}) => {
  await expect(
    page.getByRole('columnheader', { name: /Days late/i }),
  ).toHaveAttribute('aria-sort', 'descending')

  const first = await daysLateAt(page, 0)
  const second = await daysLateAt(page, 1)
  expect(first).not.toBeNull()
  expect(second).not.toBeNull()
  expect(first!).toBeGreaterThanOrEqual(second!)

  // Overdue rows must never sit below settled ones on the default sort.
  await expect(dataRows(page).first().getByText('Overdue')).toBeVisible()
})

test('the overdue tile narrows the table to exactly the overdue set', async ({ page }) => {
  const before = await readStatus(page)
  expect(before.total).toBe(200)

  const tile = page.getByRole('button', { name: /^Show only overdue invoices/ })
  await tile.click()

  await expect(tile).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /^Overdue, \d+ invoices$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const after = await readStatus(page)
  expect(after.total).toBeLessThan(before.total)
  expect(after.start).toBe(1)

  // Every visible row is genuinely overdue, and carries a day count.
  const rows = dataRows(page)
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await expect(rows.nth(index).getByText('Overdue')).toBeVisible()
    expect(await daysLateAt(page, index)).toBeGreaterThan(0)
  }
})

test('an aging band narrows further and stays within its own bounds', async ({ page }) => {
  await page.getByRole('button', { name: /^Show only overdue invoices/ }).click()
  const bucket = page.getByRole('button', { name: /^31-60 days overdue, \d+ invoices$/ })
  await bucket.click()
  await expect(bucket).toHaveAttribute('aria-pressed', 'true')

  const rows = dataRows(page)
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const days = await daysLateAt(page, index)
    expect(days).toBeGreaterThanOrEqual(31)
    expect(days).toBeLessThanOrEqual(60)
  }
})

test('searching for a customer finds their invoices and recovers cleanly', async ({ page }) => {
  const anyCustomer = await dataRows(page).first().locator('.cell-customer').innerText()

  await page.getByLabel('Search').fill(anyCustomer)
  const rows = dataRows(page)
  await expect(rows.first()).toBeVisible()
  const count = await rows.count()
  for (let index = 0; index < count; index += 1) {
    await expect(rows.nth(index).locator('.cell-customer')).toHaveText(anyCustomer)
  }

  // A miss explains itself rather than rendering an empty grid.
  await page.getByLabel('Search').fill('definitely-no-such-customer')
  await expect(page.getByRole('table')).toBeHidden()
  await expect(page.getByText('No invoices match these filters')).toBeVisible()

  await page.getByRole('button', { name: 'Clear all filters' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  expect((await readStatus(page)).total).toBe(200)
})

test('sorting by amount reorders the rows largest-first', async ({ page }) => {
  await page.getByRole('columnheader', { name: /Amount/i }).getByRole('button').click()
  await expect(page.getByRole('columnheader', { name: /Amount/i })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
  // The sort must move off the old column, not accumulate.
  await expect(page.getByRole('columnheader', { name: /Days late/i })).toHaveAttribute(
    'aria-sort',
    'none',
  )

  const texts = await dataRows(page).locator('.cell-amount').allInnerTexts()
  const amounts = texts.map((text) => Number(text.replace(/[$,]/g, '')))
  expect(amounts).toEqual([...amounts].sort((a, b) => b - a))
})

test('paging walks the dataset without gaps or repeats', async ({ page }) => {
  const first = await readStatus(page)
  expect(first.start).toBe(1)
  expect(first.end).toBe(25)
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled()

  const firstNumber = await dataRows(page).first().locator('.cell-number').innerText()

  await page.getByRole('button', { name: 'Next page' }).click()
  const second = await readStatus(page)
  expect(second.start).toBe(first.end + 1)
  expect(await dataRows(page).first().locator('.cell-number').innerText()).not.toBe(firstNumber)

  await page.getByRole('button', { name: 'Page 8' }).click()
  expect(await readStatus(page)).toMatchObject({ start: 176, end: 200, total: 200 })
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
})

test('filtering from a deep page returns to page 1 instead of a blank table', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Page 8' }).click()
  expect((await readStatus(page)).start).toBe(176)

  await page.getByRole('button', { name: /^Overdue, \d+ invoices$/ }).click()

  const after = await readStatus(page)
  expect(after.start).toBe(1)
  expect(await dataRows(page).count()).toBeGreaterThan(0)
})

test('changing page size recalculates the window', async ({ page }) => {
  await page.getByLabel('Rows per page').selectOption('100')
  await expect(dataRows(page)).toHaveCount(100)
  expect(await readStatus(page)).toMatchObject({ start: 1, end: 100, total: 200 })
})

test('severity is never conveyed by colour alone', async ({ page }) => {
  const texts = await page.locator('.days-late').allInnerTexts()
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) {
    // The visible glyph is backed by words, including the screen-reader-only
    // suffix: "235 days late", or a dash plus "Not overdue". A tinted cell that
    // said only "235" would pass a colour check and fail a real user.
    const flat = text.replace(/\s+/g, ' ').trim()
    expect(flat).toMatch(/^(\d+ days? late|— ?Not overdue)$/)
  }
})
