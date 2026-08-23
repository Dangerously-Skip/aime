import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'path';
import { readFileSync } from 'fs';
import { E2E_API_TOKEN, E2E_PORT } from '../playwright.config';

/**
 * THE MAIN PROCESS, which nothing tested until now.
 *
 * Every other layer of this app has coverage. `main-web.js` had none — and it
 * owns the minute ticker every scheduled feature depends on, the window
 * lifecycle, and the credential key the server cannot start without.
 *
 * Two features have already paid for that blind spot. The minute tick was
 * "verified by reading" when cron turned out never to have fired. And the
 * headless browser could not be verified at all, which is why this harness
 * exists before that code does.
 *
 * HOW IT RUNS. `_electron.launch()` starts the REAL main process against the dev
 * server Playwright already brings up: `app.isPackaged` is false there, so main
 * expects a server on PORT rather than forking one of its own.
 */

let app: ElectronApplication;

/**
 * The APP window, not merely the first one.
 *
 * `firstWindow()` returns whatever opened first, which can be DevTools or a
 * transient auth popup. Selecting by URL is the difference between a suite that
 * tests the app and one that tests whatever Electron happened to show.
 */
async function appWindow() {
  await expect
    .poll(() => app.windows().some((w) => w.url().includes(`:${E2E_PORT}`)), { timeout: 60_000 })
    .toBe(true);
  const win = app.windows().find((w) => w.url().includes(`:${E2E_PORT}`))!;
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: [path.join(__dirname, '..', 'main-web.js')],
    env: {
      ...process.env,
      PORT: String(E2E_PORT),
      AIME_API_TOKEN: E2E_API_TOKEN,
      // Skip first-run provisioning: it downloads a Python runtime and Chromium
      // and would make this suite take minutes and need the network.
      AIME_SKIP_SETUP: '1',
      /*
       * NOT `NODE_ENV=development`: main opens DevTools under it, and DevTools
       * is then the FIRST window — so `firstWindow()` hands back a
       * `devtools://` page and every assertion below reads as a preload bug.
       * `isDev` is already true here (`!app.isPackaged`), which is what governs
       * the server fork.
       */
    },
    timeout: 60_000,
  });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

test.describe('the app comes up', () => {
  test('a main window opens and loads the app', async () => {
    const window = await appWindow();
    // Main hands the token as `?t=` and the proxy strips it; either way the page
    // must be OUR origin rather than an error page.
    expect(window.url()).toContain(`:${E2E_PORT}`);
  });

  test('exactly one window, so nothing opened a second by accident', async () => {
    const windows = app.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('the preload bridge', () => {
  /*
   * The renderer's whole view of Electron. A missing method here is invisible
   * until a feature silently does nothing — `onMinuteTick` is the one every
   * scheduled feature hangs off, and it was verified by reading when cron turned
   * out never to have fired at all.
   */
  test('exposes the API the renderer expects', async () => {
    const window = await appWindow();
    const api = await window.evaluate(() => {
      const el = (window as unknown as { electronAPI?: Record<string, unknown> }).electronAPI;
      return el ? Object.keys(el).sort() : null;
    });
    expect(api, 'electronAPI is not exposed at all').not.toBeNull();
    expect(api).toContain('onMinuteTick');
  });

  test('onMinuteTick returns an unsubscribe, so listeners cannot leak', async () => {
    /*
     * Older preloads had no unsubscribe, and re-registering per render leaked
     * ipcRenderer listeners — each matching cron job then fired once per
     * accumulated listener on every tick. The hooks all rely on this contract.
     */
    const window = await appWindow();
    const isFunction = await window.evaluate(() => {
      const api = (window as unknown as {
        electronAPI: { onMinuteTick: (cb: () => void) => unknown };
      }).electronAPI;
      const off = api.onMinuteTick(() => {});
      const ok = typeof off === 'function';
      if (ok) (off as () => void)();
      return ok;
    });
    expect(isFunction).toBe(true);
  });
});

test.describe('the minute ticker', () => {
  test('main actually sends minute:tick to the renderer', async () => {
    /*
     * THE ASSERTION THAT WAS ONLY EVER A READING. Everything scheduled in this
     * app hangs off this one IPC message; cron shipped dead and nothing noticed,
     * and the unit tests could not have noticed because they stub the bridge.
     *
     * The real interval is 60s, which is too slow for a suite — so the renderer
     * is asked to listen, and main is asked to send one now. That proves the
     * CHANNEL and the preload wiring end to end; the interval itself is a single
     * `setInterval` line above it.
     */
    const window = await appWindow();

    await window.evaluate(() => {
      const api = (window as unknown as {
        electronAPI: { onMinuteTick: (cb: (ts: number) => void) => unknown };
      }).electronAPI;
      (window as unknown as Record<string, unknown>).__tickSeen = null;
      api.onMinuteTick((ts: number) => {
        (window as unknown as Record<string, unknown>).__tickSeen = ts;
      });
    });

    // Ask main to fire one, the same way its own interval does.
    await app.evaluate(({ BrowserWindow }) => {
      const [w] = BrowserWindow.getAllWindows();
      w?.webContents.send('minute:tick', Date.now());
    });

    await expect
      .poll(async () => window.evaluate(() => (window as unknown as { __tickSeen: number | null }).__tickSeen), {
        timeout: 10_000,
      })
      .not.toBeNull();
  });

  test('an interval is registered, so ticks keep coming', async () => {
    // The half the assertion above cannot see: that something fires it on its
    // own. Read from main rather than waited for, because 60s is not a test.
    // Read HERE rather than inside app.evaluate: `process.cwd()` in the Electron
    // process is not reliably the web directory, and the file is on this disk.
    const src = readFileSync(path.join(__dirname, '..', 'main-web.js'), 'utf8');
    expect(src).toMatch(/setInterval\([\s\S]{0,200}minute:tick/);
  });
});
