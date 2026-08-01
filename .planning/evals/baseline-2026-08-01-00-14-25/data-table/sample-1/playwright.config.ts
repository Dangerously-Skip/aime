import { defineConfig, devices } from '@playwright/test'

const PORT = 5183
const HOST = '127.0.0.1'
const BASE_URL = `http://${HOST}:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : [['list']],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --host is pinned because Vite otherwise binds "localhost", which on some
    // machines resolves to ::1 only — leaving the 127.0.0.1 baseURL unanswered
    // and the whole run failing as a webServer timeout.
    command: `npm run dev -- --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
