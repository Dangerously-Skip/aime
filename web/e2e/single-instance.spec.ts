import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * A second Electron instance must refuse to run.
 *
 * Not a tidiness rule — a second instance is silently BROKEN. Chromium's Local
 * Storage is a LevelDB with a single-writer lock, and every window uses the
 * on-disk `persist:quarry` partition, so the second process cannot open it and
 * gets an empty in-memory store instead. Nothing it writes survives.
 *
 * The visible symptom is that onboarding can never be completed: the wizard
 * finishes in memory, the next launch has no record of it, and the user lands
 * back on step one forever — which is exactly how this was found, after two
 * rounds of "I can't get past this screen" that reproduced on neither headless
 * Chromium nor a single Electron instance. Settings, conversations and connector
 * state are lost the same way, just less visibly.
 *
 * Real Electron on purpose: the lock lives in the main process and the LevelDB
 * contention is the whole point, so mocking either would proves nothing.
 */

const APP_ROOT = join(__dirname, '..');

// A throwaway userData keeps the developer's real profile out of this, and makes
// the first launch a genuine first run.
function freshUserDataDir(): string {
  return join(tmpdir(), `aime-single-instance-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

test('a second instance refuses to start, so it cannot break Local Storage', async () => {
  const userData = freshUserDataDir();
  const env = { ...process.env, PORT: '3100', AIME_TEST_USER_DATA: userData };

  const first = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: APP_ROOT, env });
  try {
    const page = await first.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // The first instance owns storage and can write.
    await expect
      .poll(async () => page.evaluate(() => {
        try { localStorage.setItem('__probe', 'ok'); return localStorage.getItem('__probe'); }
        catch { return 'threw'; }
      }), { timeout: 20_000 })
      .toBe('ok');

    // The second must not get a window at all. Before the lock it DID, with an
    // empty localStorage — so assert on the window, not on a log line.
    let secondOpenedAWindow = false;
    try {
      const second = await electron.launch({
        args: ['.', `--user-data-dir=${userData}`], cwd: APP_ROOT, env, timeout: 20_000,
      });
      const secondPage = await second.firstWindow({ timeout: 8_000 }).catch(() => null);
      secondOpenedAWindow = secondPage !== null;
      await second.close().catch(() => {});
    } catch {
      // Exiting before a window appears is the correct outcome.
      secondOpenedAWindow = false;
    }
    expect(secondOpenedAWindow).toBe(false);

    // And the first instance still owns its storage afterwards.
    expect(await page.evaluate(() => localStorage.getItem('__probe'))).toBe('ok');
  } finally {
    await first.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  }
});
