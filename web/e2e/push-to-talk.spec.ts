import { test, expect, type Page } from '@playwright/test';

/**
 * Push-to-talk settings, in a real browser (P4.1).
 *
 * Covers what unit tests structurally cannot: that the accelerator editor is
 * reachable at all (its validator was previously 140 lines with no UI), that the
 * shortcut and the switch survive a reload, and that the platform is resolved
 * from the renderer rather than from `process.platform` — which exists during
 * Next's server render and does NOT exist in the client bundle, so getting it
 * wrong shows the wrong modifier key or mismatches hydration.
 *
 * Still out of reach here: `globalShortcut.register`. A system-wide shortcut
 * needs a real Electron main process, so this file asserts that the browser is
 * told honestly that the hotkey is unavailable instead of pretending.
 */

const COMPLETED_SETTINGS = JSON.stringify({ state: { onboardingComplete: true }, version: 10 });

async function openCapabilities(page: Page) {
  await page.goto('/');
  await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Meta+Comma');
  await page.getByText('Capabilities').click();
  await expect(page.getByText('Dictate with a global hotkey')).toBeVisible();
}

test('accelerator editing, validation and persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), ['aime:settings', COMPLETED_SETTINGS]);
  await openCapabilities(page);

  const input = page.getByLabel('Push-to-talk shortcut');
  await expect(input).toHaveValue('CommandOrControl+Shift+Space');
  // Playwright's Desktop Chrome reports userAgentData.platform === 'Windows'.
  await expect(page.locator('kbd').filter({ hasText: 'Ctrl+Shift+Space' })).toBeVisible();

  await input.fill('V');
  await input.press('Enter');
  await expect(page.getByText(/captured in every app/)).toBeVisible();

  await input.fill('shift + ctrl + j');
  await input.press('Enter');
  await expect(input).toHaveValue('Control+Shift+J');
  await expect(page.locator('kbd').filter({ hasText: 'Ctrl+Shift+J' })).toBeVisible();

  await page.getByRole('switch').first().click();
  await expect(page.getByText(/global hotkey needs the desktop app/)).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aime:settings')!).state);
  expect(stored.pushToTalkAccelerator).toBe('Control+Shift+J');
  expect(stored.pushToTalkEnabled).toBe(true);
  expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
});

test('mac glyphs when the Electron bridge reports darwin', async ({ page }) => {
  await page.addInitScript(([k, v]) => {
    window.localStorage.setItem(k, v);
    (window as unknown as { electronAPI: unknown }).electronAPI = { getPlatform: () => 'darwin' };
  }, ['aime:settings', COMPLETED_SETTINGS]);
  await openCapabilities(page);
  await expect(page.locator('kbd').filter({ hasText: '⌘⇧Space' })).toBeVisible();
});

test('a stored accelerator survives a reload', async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    'aime:settings',
    JSON.stringify({ state: { onboardingComplete: true, pushToTalkEnabled: true, pushToTalkAccelerator: 'Control+Alt+K' }, version: 10 }),
  ]);
  await openCapabilities(page);
  await expect(page.getByLabel('Push-to-talk shortcut')).toHaveValue('Control+Alt+K');
  await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true');
});
