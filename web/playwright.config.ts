import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke tests against `next dev`.
 * Runs on port 3100 to avoid clashing with a locally running app.
 */
/**
 * The local API now requires a credential (`src/lib/auth/local-token.ts`), and
 * `npm run dev` does not mint one — only `dev-with-port.js` and the packaged app
 * do. So the suite supplies its own and hands it to the browser context, which
 * attaches it to every request the page makes. No spec needs to know.
 *
 * A fixed value is correct here and would not be anywhere else: this server is
 * ephemeral, on loopback, and holds nothing.
 */
export const E2E_API_TOKEN = 'e2e-' + 'x'.repeat(60);

/** The port the dev server and Electron must agree on. */
export const E2E_PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    extraHTTPHeaders: { Authorization: `Bearer ${E2E_API_TOKEN}` },
  },
  projects: [
    {
      name: 'chromium',
      // The browser specs. Electron ones are excluded so they do not get a
      // browser context they cannot use.
      testIgnore: /\.electron\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      /*
       * THE MAIN PROCESS, which nothing tested until now.
       *
       * Every other layer has coverage; `main-web.js` had none, and it holds the
       * minute ticker every scheduled feature depends on, the window lifecycle,
       * and — as of the headless browser — a piece of agent infrastructure. Two
       * features have already hit this blind spot: the tick was verified by
       * reading, and the headless browser could not be verified at all.
       *
       * `_electron.launch()` runs the REAL main process against the dev server
       * Playwright already starts, because `app.isPackaged` is false there and
       * main expects a server on PORT rather than forking one.
       */
      name: 'electron',
      testMatch: /\.electron\.spec\.ts$/,
      /*
       * ONE AT A TIME. The app takes a single-instance lock, so parallel workers
       * each launching their own Electron leave all but the first dead — and the
       * symptom is `electronAPI is undefined`, which reads like a preload bug
       * rather than a harness one.
       */
      fullyParallel: false,
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3100',
    // `/` and not `/api/health`: the health route is authenticated now, and
    // Playwright treats a 401 as "not ready" and waits until it times out.
    url: 'http://localhost:3100/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { AIME_API_TOKEN: E2E_API_TOKEN },
  },
});
