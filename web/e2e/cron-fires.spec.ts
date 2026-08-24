import { test, expect } from '@playwright/test';

/**
 * A DUE SCHEDULED JOB ACTUALLY FIRES — end to end, in the real app.
 *
 * Cron jobs never ran. Not once, for any user: `useCron` was written, tested,
 * and called from nowhere, so no tick could reach it. Everything looked healthy
 * from outside — the UI worked, the store persisted, the unit tests passed —
 * because every one of those asks whether the hook BEHAVES, and none asks
 * whether it is connected to anything.
 *
 * So this drives the whole renderer chain in a real browser:
 *
 *     minute tick → useCron → isJobDue → onFire → surface + recorded run
 *
 * Jobs live in the ORDER MANIFEST now (DR-24). The browser cron store this
 * suite used to seed no longer exists, and an attended order is what a cron job
 * became — same expression, same ticker, different filing cabinet.
 *
 * The one link it cannot cover is Electron's `setInterval` → `webContents.send`,
 * because Playwright runs the Next app rather than Electron. That is covered by
 * `main-process.electron.spec.ts`; what is faked here is ONLY the transport, at
 * exactly the seam the preload occupies.
 */

/*
 * SERIAL, because these tests share ONE server-side manifest.
 *
 * The jobs live in `order-schedule.json` on disk, so every test in this file
 * writes the same file — and under `fullyParallel` each PUT clobbers the others
 * mid-run. The symptom was a DIFFERENT two or three tests failing on each
 * invocation, which reads as flakiness in the feature rather than in the
 * fixture.
 *
 * That is a property of any e2e touching the manifest, not of these tests: the
 * renderer store they replaced was per-context and therefore isolated for free.
 */
test.describe.configure({ mode: 'serial' });

/** An attended order due whenever we tick. */
const ORDER = {
  id: 'e2e-job-1',
  instruction: 'Re-price the watchlist',
  attended: true,
  surfaceId: 'browser',
  trigger: { type: 'cron', expression: '* * * * *' },
  notifyVia: 'surface',
  state: {},
  status: 'active',
  runCount: 0,
  errorCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

/** Stand in for the preload bridge, and seed a completed onboarding. */
async function prepare(page: import('@playwright/test').Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ['aime:settings', JSON.stringify({ state: { onboardingComplete: true }, version: 6 })],
  );
  await page.addInitScript(() => {
    const listeners: ((ts: number) => void)[] = [];
    (window as unknown as Record<string, unknown>).electronAPI = {
      onMinuteTick: (cb: (ts: number) => void) => {
        listeners.push(cb);
        return () => listeners.splice(listeners.indexOf(cb), 1);
      },
    };
    (window as unknown as Record<string, unknown>).__fireTick = (ts: number) =>
      listeners.forEach((l) => l(ts));
    (window as unknown as Record<string, unknown>).__tickListeners = () => listeners.length;
  });
}

const fireTick = (page: import('@playwright/test').Page, at = Date.now()) =>
  page.evaluate((ts) => {
    (window as unknown as { __fireTick: (ts: number) => void }).__fireTick(ts);
  }, at);

test.describe('a due job reaches its surface', () => {
  test.beforeEach(async ({ page, request }) => {
    await request.put('/api/schedule/orders', { data: { orders: [ORDER] } });
    await prepare(page);
    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
    // The manifest is pulled between ticks; give the first pull a moment.
    await page.waitForTimeout(1500);
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/schedule/orders', { data: { orders: [] } });
  });

  test('something is actually listening for the tick', async ({ page }) => {
    /*
     * THE ASSERTION THE WHOLE BUG COMES DOWN TO. For the life of the feature
     * this was zero: the hook existed, nothing called it, and every job sat
     * there for ever.
     */
    const listeners = await page.evaluate(
      () => (window as unknown as { __tickListeners: () => number }).__tickListeners(),
    );
    expect(listeners, 'nothing subscribed to the minute tick').toBeGreaterThan(0);
  });

  test('a due job switches to its surface', async ({ page }) => {
    await page.getByRole('button', { name: 'Code', exact: true }).click().catch(() => {});
    await fireTick(page);
    // The Browser surface's own chrome proves it is VISIBLE, not merely mounted
    // — every surface always is.
    await expect(page.getByPlaceholder('Enter URL or search...')).toBeVisible({ timeout: 10_000 });
  });

  test('THE JOB ACTUALLY RUNS — a turn starts on that surface', async ({ page }) => {
    /*
     * The half this suite once proved and did not: it asserted the surface
     * switch and the recorded run, both of which worked, while nothing executed
     * the prompt.
     */
    const posts: string[] = [];
    await page.route('**/api/chat/**', async (route) => {
      posts.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"done"}\n\n',
      });
    });

    await fireTick(page);
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(posts.join(' ')).toContain('/api/chat/browser');
  });

  test('the run is recorded, so it does not fire again', async ({ page, request }) => {
    /*
     * A FRESH ID, because `mergeOrders` deliberately keeps a server-recorded
     * `lastRun` when it is newer than the incoming one — that is what stops a
     * stale client erasing work done while it was closed. So reseeding the same
     * id cannot reset the run, and the earlier tests in this serial file have
     * already fired it.
     */
    const id = `e2e-run-${Date.now()}`;
    await request.put('/api/schedule/orders', { data: { orders: [{ ...ORDER, id }] } });
    await page.reload();
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    /*
     * A recorded `lastRun` proves the HANDLER ran rather than merely that a
     * surface changed, and guards the other half: without it a `* * * * *` job
     * re-fires on every tick for ever.
     *
     * Read from the MANIFEST — the browser store this used to check is gone.
     */
    const lastRun = async () => {
      const res = await request.get('/api/schedule/orders');
      const body = (await res.json()) as { orders?: Array<{ id?: string; lastRun?: number }> };
      return body.orders?.find((o) => (o as { id?: string }).id === id)?.lastRun ?? null;
    };
    expect(await lastRun(), 'the seeded job should start un-run').toBeNull();

    await fireTick(page);
    await expect.poll(lastRun, { timeout: 10_000 }).not.toBeNull();
  });
});

test.describe('a job that is not due stays put', () => {
  test.beforeEach(async ({ page, request }) => {
    await request.put('/api/schedule/orders', {
      data: { orders: [{ ...ORDER, trigger: { type: 'cron', expression: '0 3 * * *' } }] },
    });
    await prepare(page);
    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/schedule/orders', { data: { orders: [] } });
  });

  test('does not fire, and does not switch surface', async ({ page, request }) => {
    // Without this, a ticker that ignored the expression entirely would pass
    // everything above.
    await page.getByRole('button', { name: 'Code', exact: true }).click().catch(() => {});
    const at = new Date();
    at.setHours(14, 7, 0, 0); // not 03:00
    await fireTick(page, at.getTime());

    await page.waitForTimeout(1000);
    const res = await request.get('/api/schedule/orders');
    const body = (await res.json()) as { orders?: Array<{ lastRun?: number }> };
    expect(body.orders?.[0]?.lastRun ?? null, 'a job that was not due was marked as run').toBeNull();
    await expect(page.getByPlaceholder('Enter URL or search...')).not.toBeVisible();
  });
});
