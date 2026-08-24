import { test, expect } from '@playwright/test';

/**
 * A DUE CRON JOB ACTUALLY FIRES — end to end, in the real app.
 *
 * Cron jobs never ran. Not once, for any user: `useCron` was written, tested,
 * and called from nowhere, so no tick could reach it. Everything about the
 * feature looked healthy from outside — the UI worked, the store persisted, the
 * unit tests passed — because every one of those checks asks whether the hook
 * behaves, and none asks whether it is connected to anything.
 *
 * So this drives the whole renderer chain in a real browser:
 *
 *     minute tick → useCron → matchesCron → onFire → context bus + surface
 *
 * The one link it cannot cover is Electron's `setInterval` → `webContents.send`,
 * because Playwright runs the Next app rather than Electron. That is read and
 * verified separately (main-web.js sends `minute:tick` every 60s, preload
 * exposes it as `onMinuteTick`); what is faked here is ONLY the transport, and
 * it is faked at exactly the seam the preload occupies.
 */

/** A job due at the moment we fire, targeting the Browser surface. */
const JOB = {
  id: 'e2e-cron-1',
  expression: '* * * * *', // every minute — due whenever we tick
  prompt: 'Re-price the watchlist',
  surfaceId: 'browser',
  lastRun: null,
  enabled: true,
  createdAt: 1,
};

test.describe('a due cron job reaches its surface', () => {
  test.beforeEach(async ({ page }) => {
    /*
     * Stand in for the preload bridge, and keep a handle on the callback so the
     * test can deliver a tick on demand rather than waiting a real minute.
     *
     * `addInitScript` runs before any app code, which matters: `useCron`
     * registers exactly once and bails immediately if the API is absent.
     */
    // Without this the app boots the onboarding wizard and no shell exists.
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ['aime:settings', JSON.stringify({ state: { onboardingComplete: true }, version: 6 })],
    );

    await page.addInitScript(
      ([storeKey, job]) => {
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

        // Seed a due job the way the persisted store would have restored one.
        localStorage.setItem(
          storeKey as string,
          JSON.stringify({ state: { jobs: [job] }, version: 0 }),
        );
      },
      ['aime:cron', JOB] as const,
    );

    await page.goto('/');
    // The shell has to be up before the hook can have registered. 'New Chat' is
    // what smoke.spec waits for, so it is the known-good signal.
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  });

  test('something is actually listening for the tick', async ({ page }) => {
    /*
     * THE ASSERTION THE WHOLE BUG COMES DOWN TO. For the life of the feature
     * this was zero: the hook existed and nothing called it, so the count of
     * registered tick listeners was nought and every job sat there for ever.
     */
    const listeners = await page.evaluate(
      () => (window as unknown as { __tickListeners: () => number }).__tickListeners(),
    );
    expect(listeners, 'nothing subscribed to the minute tick').toBeGreaterThan(0);
  });

  test('a due job switches to its surface when the tick arrives', async ({ page }) => {
    // Start somewhere else, so the switch is observable rather than incidental.
    await page.getByRole('button', { name: 'Code', exact: true }).click().catch(() => {});

    await page.evaluate(() => {
      (window as unknown as { __fireTick: (ts: number) => void }).__fireTick(Date.now());
    });

    // The Browser surface's own chrome — its address bar — is the proof it is
    // the visible one, rather than merely mounted (every surface always is).
    await expect(page.getByPlaceholder('Enter URL or search...')).toBeVisible({ timeout: 10_000 });
  });

  test('THE JOB ACTUALLY RUNS — a turn starts on the target surface', async ({ page }) => {
    /*
     * The half this suite proved and did not: it asserted the surface switch and
     * `lastRun`, both of which worked, while nothing executed the prompt.
     *
     * The job published to the context bus and the call site said "the surface
     * named by the job owns actually running it" — but nothing subscribed. Code
     * and Cowork fold unconsumed bus events into the NEXT HUMAN MESSAGE; chat,
     * browser and assistant never read the bus at all.
     *
     * A started turn is observable without a provider: the surface POSTs to its
     * chat route. Watching the network is the difference between "the UI moved"
     * and "the work began".
     */
    const posts: string[] = [];
    await page.route('**/api/chat/**', async (route) => {
      posts.push(route.request().url());
      // Answer with a minimal SSE stream so the surface does not error out.
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"done"}\n\n',
      });
    });

    await page.evaluate(() => {
      (window as unknown as { __fireTick: (ts: number) => void }).__fireTick(Date.now());
    });

    await expect.poll(() => posts.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(posts.join(' '), 'the turn did not go to the browser surface').toContain('/api/chat/browser');
  });

  test('the job is marked as run, so it does not fire again', async ({ page }) => {
    /*
     * `markRan` is the first thing the tick handler does, so a recorded
     * `lastRun` proves the handler ran rather than merely that a surface
     * changed — and it is observable, because the store persists.
     *
     * It also guards the other half: without it, a job matching `* * * * *`
     * would re-fire on every tick for ever.
     */
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('aime:cron') || '{}')?.state?.jobs?.[0]?.lastRun ?? null,
    );
    expect(before, 'seeded job should start un-run').toBeNull();

    await page.evaluate(() => {
      (window as unknown as { __fireTick: (ts: number) => void }).__fireTick(Date.now());
    });

    await expect
      .poll(async () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem('aime:cron') || '{}')?.state?.jobs?.[0]?.lastRun ?? null,
        ),
      )
      .not.toBeNull();
  });
});

test.describe('an ATTENDED job in the manifest fires too', () => {
  /*
   * DR-24 step 3: the renderer reads BOTH stores so the migration has no window
   * where a job lives somewhere nothing ticks.
   *
   * Removing the manifest read broke no test and no e2e — the suite seeded only
   * the cron store, so it could not tell the difference. This seeds the manifest
   * instead, which is where jobs will live after step 4.
   */
  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ['aime:settings', JSON.stringify({ state: { onboardingComplete: true }, version: 6 })],
    );
    // Deliberately NO cron-store seed: the manifest must carry this alone.
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
      localStorage.setItem('aime:cron', JSON.stringify({ state: { jobs: [] }, version: 0 }));
    });

    await request.put('/api/schedule/orders', {
      data: {
        orders: [{
          id: 'attended-1',
          instruction: 'Re-price the watchlist',
          attended: true,
          surfaceId: 'browser',
          trigger: { type: 'cron', expression: '* * * * *' },
          notifyVia: 'card',
          state: {},
          status: 'active',
          runCount: 0,
          errorCount: 0,
          createdAt: 1,
          updatedAt: 1,
        }],
      },
    });

    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/schedule/orders', { data: { orders: [] } });
  });

  test('an attended manifest job reaches its surface', async ({ page }) => {
    // The manifest is pulled between ticks, so give the first pull a moment.
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      (window as unknown as { __fireTick: (ts: number) => void }).__fireTick(Date.now());
    });
    await expect(page.getByPlaceholder('Enter URL or search...')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('a job that is not due stays put', () => {
  /*
   * Its own block, with its own seed. Sharing the outer `beforeEach` meant the
   * init script re-installed the DUE job on reload and overwrote this one — a
   * test that failed because of its own setup rather than the code.
   */
  test.beforeEach(async ({ page }) => {
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
      localStorage.setItem(
        'aime:cron',
        JSON.stringify({
          state: {
            jobs: [{
              id: 'never', expression: '0 3 * * *', prompt: 'nope',
              surfaceId: 'browser', lastRun: null, enabled: true, createdAt: 1,
            }],
          },
          version: 0,
        }),
      );
    });
    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  });

  test('does not fire, and does not switch surface', async ({ page }) => {
    // Otherwise "it fired" proves nothing — a hook that fired on every tick
    // regardless of the expression would pass every test above.
    await page.evaluate(() => {
      const at = new Date();
      at.setHours(14, 7, 0, 0); // not 03:00
      (window as unknown as { __fireTick: (ts: number) => void }).__fireTick(at.getTime());
    });

    await page.waitForTimeout(1000);
    const lastRun = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('aime:cron') || '{}')?.state?.jobs?.[0]?.lastRun ?? null,
    );
    expect(lastRun, 'a job that was not due was marked as run').toBeNull();
    await expect(page.getByPlaceholder('Enter URL or search...')).not.toBeVisible();
  });
});
