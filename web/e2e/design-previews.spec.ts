import { test, expect, type Page } from '@playwright/test';

/**
 * THE DESIGN PREVIEWS RENDER THEIR THEME, AND SAY SO WHEN THEY CANNOT.
 *
 * Reported as "designs aren't showing up properly": every card in the gallery
 * showed the same small serif text in the corner of an empty dark rectangle,
 * including "Minimal White". Serif is the tell — nothing in `base.css` asks for
 * a serif face, so the previews were not styled wrongly, they were not styled
 * at all.
 *
 * The previews linked their stylesheets from `/api/themes/asset`, and every
 * `/api` route requires the local session cookie — which a `sandbox=""` iframe,
 * having an opaque origin, stops sending once that cookie goes stale. A 401'd
 * `<link rel=stylesheet>` is dropped by the browser silently: no error, no
 * event, nothing the app can see. Thirty-six broken requests looked like
 * thirty-six boring themes.
 *
 * MY FIRST VERSION OF THIS FILE PASSED AGAINST THE BUG. It asserted "no asset
 * request was refused" (vacuously true when none is made) and "the srcDoc
 * matches /--bg/" (matched by the inline scaling comment). Both were about the
 * MECHANISM. These assert the RESULT: real declarations from base.css present
 * in the frame, and two themes differing in their actual CSS.
 */

async function openDesign(page: Page) {
  await page.goto('/');
  await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Customize$/ }).click();
  await page.getByRole('button', { name: /^Design$/ }).click();
  await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible();
}

/** srcdoc of the nth preview, once it has its CSS. */
async function srcdocOf(page: Page, n: number): Promise<string> {
  const frame = page.locator('iframe').nth(n);
  await expect(frame).toBeAttached({ timeout: 20_000 });
  let doc = '';
  await expect
    .poll(async () => {
      doc = (await frame.getAttribute('srcdoc')) ?? '';
      return doc.length;
    }, { timeout: 20_000 })
    .toBeGreaterThan(2_000);
  return doc;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    'aime:settings',
    JSON.stringify({ state: { onboardingComplete: true }, version: 6 }),
  ]);
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).electronAPI = {
      onMinuteTick: () => () => {},
      showNotification: () => {},
    };
  });
});

test('the frame CARRIES base.css, rather than linking to it', async ({ page }) => {
  await openDesign(page);
  const doc = await srcdocOf(page, 0);

  // Real rules, not a URL that may or may not resolve.
  expect(doc, 'no slide markup').toContain('class="slide');
  expect(doc, 'base.css is not in the frame').toMatch(/\.slide\s*\{/);
  expect(doc, 'the frame still links a credentialed stylesheet').not.toContain(
    'rel="stylesheet" href="/api/',
  );
});

test('two themes differ in their actual CSS, not just a filename', async ({ page }) => {
  await openDesign(page);
  const a = await srcdocOf(page, 0);
  const b = await srcdocOf(page, 1);

  /*
   * The previous version compared whole srcDocs, which differed by the theme
   * id in an href even when every frame rendered identically. Comparing the
   * `--bg` each theme declares is comparing what you actually see.
   */
  const bg = (doc: string) => [...doc.matchAll(/--bg\s*:\s*([^;]+);/g)].map((m) => m[1].trim()).pop();
  expect(bg(a), 'no --bg declared — the theme file is missing').toBeTruthy();
  expect(bg(a)).not.toBe(bg(b));
});

test('the iframe makes no same-origin request at all', async ({ page }) => {
  /*
   * The property that makes this robust rather than merely fixed: content the
   * frame already HAS cannot be refused. Asserted as the absence of any
   * `/api/themes/asset` load AFTER the panel has painted — the parent fetches
   * them, and that is a different, credentialed context.
   */
  await openDesign(page);
  await srcdocOf(page, 0);

  const late: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/themes/asset') && r.frame() !== page.mainFrame()) {
      late.push(r.url());
    }
  });
  await page.waitForTimeout(2_500);
  expect(late, 'a preview iframe is still fetching credentialed assets').toEqual([]);
});

test('a preview that cannot load says so instead of rendering blank', async ({ page }) => {
  /*
   * The failure this whole class of bug hid behind. A design gallery that
   * cannot load its designs must say so — showing an unstyled slide instead
   * reads as a real (bad) theme.
   */
  await page.route('**/api/themes/asset**', (route) => route.fulfill({ status: 401, body: '{}' }));
  await openDesign(page);

  await expect(page.getByText('Preview unavailable').first()).toBeVisible({ timeout: 20_000 });
});
