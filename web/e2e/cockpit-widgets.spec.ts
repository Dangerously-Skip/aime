import { test, expect, type Page } from '@playwright/test';

/**
 * EVERY BUTTON ON THE COCKPIT ACTUALLY DOES SOMETHING — in a real browser.
 *
 * Asked for directly: "I can't delete or scroll widgets. ensure all buttons on
 * this cockpit view actually work."
 *
 * Both reported symptoms were real and neither was the button's fault, which is
 * exactly why unit tests missed them:
 *
 *   - SCROLL. `<ScrollArea className="flex-1">` inside a chain of flex items
 *     that never said `min-h-0`. A flex item will not shrink below its content,
 *     so the scroll container was sized to fit every widget and the ones past
 *     the fold were clipped by the window. Nothing scrolled because nothing was
 *     ever too tall for its box — the box was too tall for the screen. Only a
 *     real layout can catch that; jsdom has no layout at all.
 *
 *   - DELETE. Two clicks by design (arm, then confirm), with a 3s disarm. That
 *     is defensible, but nothing tested that the second click lands or that the
 *     first is visibly distinguishable, so "it doesn't delete" and "it needs
 *     two clicks and I didn't know" are indistinguishable from a bug report.
 *
 * A tile is DOM, so the temptation is a jsdom test. The two things actually
 * broken here are layout and a real click sequence.
 */

/** Widgets are seeded pre-rendered, so nothing here depends on a model or network. */
const widget = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  recipe: `recipe for ${title}`,
  refreshKind: 'clocks',
  // A rendered node: `clocks` is pure computation, so a refresh in-test needs no
  // network at all. Weather and tickers would reach out.
  render: { type: 'statGrid', items: [{ label: 'Sydney', value: '10:00' }] },
  refreshedAt: 1,
  enabled: true,
  createdAt: 1,
  ...over,
});

/*
 * Enough tiles that the grid MUST overflow.
 *
 * 14 was not: the masonry is `columns: 280px`, so on a 1280px viewport they
 * spread across four columns roughly 393px tall and fitted exactly. A scroll
 * test that does not overflow proves nothing, and it would have passed against
 * the broken layout too.
 */
const MANY = Array.from({ length: 48 }, (_, i) => widget(`e2e-w-${i}`, `Widget ${i}`));

async function prepare(page: Page, widgets: unknown[]) {
  await page.addInitScript(
    ([settingsKey, settings, widgetKey, widgetState]) => {
      window.localStorage.setItem(settingsKey, settings);
      window.localStorage.setItem(widgetKey, widgetState);
    },
    [
      'aime:settings',
      JSON.stringify({ state: { onboardingComplete: true }, version: 6 }),
      'aime:widgets',
      JSON.stringify({ state: { widgets }, version: 0 }),
    ],
  );
  // The tick bridge the preload normally supplies; absent it, hooks that
  // subscribe would throw on a bare browser.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).electronAPI = {
      onMinuteTick: () => () => {},
      showNotification: () => {},
    };
  });
}

async function openCockpit(page: Page) {
  await page.goto('/');
  await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Cockpit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible();
}

test.describe('the Cockpit widget grid', () => {
  test('SCROLLS when there are more widgets than fit', async ({ page }) => {
    await prepare(page, MANY);
    await openCockpit(page);
    await expect(page.getByText('Widget 0')).toBeVisible();

    /*
     * Base UI (not Radix) — the overflow lives on the viewport slot. Scoped by
     * CONTENT, not `.first()`: the conversation sidebar has its own ScrollArea
     * and it comes first in the DOM, so `.first()` measured a 249px-wide panel
     * that had nothing to do with the Cockpit and reported a false failure.
     */
    const viewport = page
      .locator('[data-slot="scroll-area-viewport"]')
      .filter({ has: page.getByText('Widget 0') });
    const metrics = await viewport.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));

    /*
     * THE ASSERTION THE BUG COMES DOWN TO. Before the fix these were equal: the
     * viewport had been sized to its own content, so there was nothing to
     * scroll and the overflow spilled out of the window instead.
     */
    expect(metrics.client, 'the scroll viewport has no height').toBeGreaterThan(0);
    expect(
      metrics.scroll,
      'content fits the viewport exactly — it was sized to fit rather than to scroll',
    ).toBeGreaterThan(metrics.client);

    await viewport.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);
  });

  test('the last widget can actually be reached', async ({ page }) => {
    // Scroll height alone would pass on a container that scrolls but clips.
    await prepare(page, MANY);
    await openCockpit(page);
    await page.getByText('Widget 47').scrollIntoViewIfNeeded();
    await expect(page.getByText('Widget 47')).toBeInViewport();
  });
});

test.describe('every button on a tile', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page, [widget('e2e-solo', 'Solo widget')]);
    await openCockpit(page);
    await expect(page.getByText('Solo widget')).toBeVisible();
  });

  const tile = (page: Page) =>
    page.locator('div').filter({ hasText: /^Solo widget/ }).first();

  test('DELETE works AT HUMAN PACE — the version that was actually broken', async ({ page }) => {
    /*
     * The previous test clicked twice ~50ms apart and passed while the feature
     * was unusable. Arming only tinted a 12px icon inside a 20px square and
     * disarmed after 3s, so the sequence a person performs — click, look for
     * feedback, find none, click again — re-armed instead of deleting.
     *
     * Reported three times. A confirmation step tested only at machine speed
     * has not been tested at all, so this one PAUSES like a person does.
     */
    await page.getByRole('button', { name: 'Delete widget' }).click();

    // It must say the word. A colour change on an icon this small is not a
    // state the user can be asked to confirm.
    const confirm = page.getByRole('button', { name: 'Confirm delete' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveText(/delete\?/i);

    /*
     * PAST THE OLD 3s WINDOW, deliberately. At 2.5s this assertion passed
     * against the broken timing too — under the old limit, so it proved only
     * that some window existed. A regression test whose input does not cross
     * the boundary tests nothing about the boundary.
     */
    await page.waitForTimeout(3_800);
    await expect(confirm, 'disarmed before a human could read it and act').toBeVisible();

    await confirm.click();
    await expect(page.getByText('Solo widget')).toHaveCount(0);

    // And it STAYS deleted — a pull that re-added it would be the real
    // "I can't delete" bug, and it would only appear after a tick.
    await page.waitForTimeout(1_000);
    await expect(page.getByText('Solo widget')).toHaveCount(0);
  });

  test('delete DISARMS eventually — a forgotten click cannot delete later', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete widget' }).click();
    await expect(page.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
    // 5s window; back to the plain icon after it.
    await expect(page.getByRole('button', { name: 'Delete widget' })).toBeVisible({ timeout: 9_000 });
    await expect(page.getByText('Solo widget')).toHaveCount(1);
  });

  test('PAUSE toggles the schedule, and says which state it is in', async ({ page }) => {
    await page.getByRole('button', { name: 'Pause schedule' }).click();
    await expect(page.getByRole('button', { name: 'Resume schedule' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume schedule' }).click();
    await expect(page.getByRole('button', { name: 'Pause schedule' })).toBeVisible();
  });

  test('NOTIFY toggles, and persists to the store', async ({ page }) => {
    await page.getByRole('button', { name: /notify me when this changes/i }).click();
    await expect(page.getByRole('button', { name: /mute notifications/i })).toBeVisible();

    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('aime:widgets');
      return raw ? JSON.parse(raw).state.widgets[0].notifyOnChange : null;
    });
    expect(stored, 'the toggle changed the icon but not the widget').toBe(true);
  });

  test('REFRESH re-renders the tile', async ({ page }) => {
    await page.getByRole('button', { name: 'Refresh now' }).click();
    // `clocks` is pure computation, so this completes without network. The
    // relative timestamp flipping to "just now" is the observable effect.
    await expect(tile(page).getByText(/just now|working/i)).toBeVisible({ timeout: 10_000 });
  });

  test('CONFIGURE opens the editor and the change reaches the tile', async ({ page }) => {
    await page.getByRole('button', { name: /configure what this shows/i }).click();
    const zones = page.getByLabel('Time zones');
    await expect(zones).toBeVisible();

    await zones.fill('Europe/Lisbon');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    /*
     * The whole point of the feature: a saved setting must show up on the tile
     * without waiting for its schedule. The clock widget relabels by city, so
     * "Lisbon" appearing IS the config having been read back.
     */
    await expect(page.getByText('Lisbon')).toBeVisible({ timeout: 10_000 });

    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('aime:widgets');
      return raw ? JSON.parse(raw).state.widgets[0].config : null;
    });
    expect(stored?.clocks?.[0]?.tz).toBe('Europe/Lisbon');
  });

  test('ASK ABOUT THIS opens a chat seeded with the tile', async ({ page }) => {
    await page.getByRole('button', { name: 'Ask about this' }).click();
    // It switches surface, which is the observable half — the seeded message is
    // covered by widget-to-text's own tests.
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
  });
});

test.describe('the Cockpit header and grid controls', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page, [widget('e2e-hdr', 'Header widget')]);
    await openCockpit(page);
  });

  test('the header refresh reloads the run log without erroring', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // `exact`, because the tiles each have a "Refresh now".
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('NEW WIDGET opens the form and creates one', async ({ page }) => {
    await page.getByRole('button', { name: /new widget/i }).click();
    await page.getByPlaceholder(/Recipe/).fill('Count open PRs');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('Count open PRs')).toBeVisible();
  });

  test('a QUICK-ADD preset appears immediately, on this same screen', async ({ page }) => {
    /*
     * The whole three-round saga in one assertion. These buttons used to be on
     * the Activity tab and created widgets the Cockpit displayed, so clicking
     * one did nothing you could see.
     */
    await page.getByRole('button', { name: /world clock/i }).click();
    // The TILE, not the button that made it — both carry the same text.
    await expect(page.getByRole('paragraph').filter({ hasText: 'World clock' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('CANCEL on the form creates nothing', async ({ page }) => {
    await page.getByRole('button', { name: /new widget/i }).click();
    await page.getByPlaceholder(/Recipe/).fill('Should not exist');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByText('Should not exist')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /new widget/i })).toBeVisible();
  });
});
