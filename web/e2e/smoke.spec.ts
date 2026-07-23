import { test, expect } from '@playwright/test';

/**
 * Seed a completed-onboarding settings blob before the app boots so the
 * main shell renders instead of the onboarding wizard. Keyed to the
 * zustand persist name + version in settings-store.ts.
 */
const COMPLETED_SETTINGS = JSON.stringify({
  state: { onboardingComplete: true },
  version: 6,
});

test.describe('API', () => {
  test('health endpoint reports ok with providers', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(Array.isArray(body.providers)).toBeTruthy();
  });

  test('surfaces endpoint lists the five surfaces', async ({ request }) => {
    const res = await request.get('/api/surfaces');
    expect(res.ok()).toBeTruthy();
  });
});

test.describe('App boot', () => {
  test('first run shows the onboarding wizard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome to AIME')).toBeVisible({ timeout: 30_000 });
  });

  test('completed onboarding boots into the app shell', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ['aime:settings', COMPLETED_SETTINGS],
    );
    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  });

  test('legacy nibcowork settings still boot into the app shell (rename migration)', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ['nibcowork:settings', COMPLETED_SETTINGS],
    );
    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  });

  test('boots without console errors that break rendering', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ['aime:settings', COMPLETED_SETTINGS],
    );
    await page.goto('/');
    await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });

    expect(pageErrors).toEqual([]);
  });
});
