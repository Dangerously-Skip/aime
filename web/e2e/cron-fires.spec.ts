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
