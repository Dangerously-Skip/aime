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
const E2E_API_TOKEN = 'e2e-' + 'x'.repeat(60);

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
      use: { ...devices['Desktop Chrome'] },
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
