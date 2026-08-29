import { test, expect, type Page } from '@playwright/test';

/**
 * THE FILE VIEWER DRAWS NO BOXES, AND CHAT STILL DOES.
 *
 * Reported as code appearing "in a dark gray box, inside a lighter gray box
 * inside a dark almost black box". Both greys came from GLOBAL element
 * selectors written for markdown:
 *
 *   pre       { background: var(--muted); border; radius; padding }  → #332E2B
 *   .dark .hljs { background: #252522 !important }                   → #252522
 *
 * `code-renderer.tsx` already carried a comment saying it renders "No card
 * chrome", and it does — it dropped its own `rounded-lg bg-muted/40 p-4`. That
 * was true of the component and false of the page, because a component cannot
 * opt out of a global element selector. The comment described an intention the
 * stylesheet overruled, which is why three previous passes at this did not fix
 * it.
 *
 * Measured as COMPUTED STYLE rather than by eye: "looks flat" is exactly the
 * judgement that let two nested boxes ship.
 */

async function boot(page: Page) {
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
  await page.goto('/');
  await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
}

/** Computed chrome of a `pre`/`code` pair rendered inside `wrapperClass`. */
async function chromeIn(page: Page, wrapperClass: string) {
  return page.evaluate((cls) => {
    document.documentElement.classList.add('dark');
    const host = document.createElement('div');
    host.className = cls;
    host.innerHTML = '<pre><code class="hljs language-js">const a = 1;</code></pre>';
    document.body.appendChild(host);
    const read = (el: Element) => {
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        borderWidth: parseFloat(s.borderTopWidth),
        radius: parseFloat(s.borderTopLeftRadius),
        padding: parseFloat(s.paddingTop),
      };
    };
    const out = { pre: read(host.querySelector('pre')!), code: read(host.querySelector('code')!) };
    host.remove();
    return out;
  }, wrapperClass);
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

test('an open file sits directly on the panel — no box, no border, no radius', async ({ page }) => {
  await boot(page);
  const { pre, code } = await chromeIn(page, 'file-viewer-body');

  expect(pre.bg, 'the outer grey box is back').toBe(TRANSPARENT);
  expect(code.bg, 'the inner grey box is back').toBe(TRANSPARENT);
  expect(pre.borderWidth).toBe(0);
  expect(pre.radius).toBe(0);
  // Padding belongs to `.file-viewer-body`, which is the one place that decides it.
  expect(pre.padding).toBe(0);
});

test('the diff viewer gets the same treatment', async ({ page }) => {
  await boot(page);
  const { pre, code } = await chromeIn(page, 'diff-viewer-body');
  expect(pre.bg).toBe(TRANSPARENT);
  expect(code.bg).toBe(TRANSPARENT);
});

test('a markdown code block in chat STILL gets its box', async ({ page }) => {
  /*
   * The half a careless fix breaks. A fenced block inside prose SHOULD read as
   * an inset object — that is what those global rules are for, and deleting
   * them instead of scoping them would flatten every code block in every reply.
   */
  await boot(page);
  const { pre, code } = await chromeIn(page, 'markdown-content');

  expect(pre.bg, 'chat code blocks lost their background').not.toBe(TRANSPARENT);
  expect(pre.borderWidth).toBeGreaterThan(0);
  expect(pre.radius).toBeGreaterThan(0);
  expect(code.bg, 'chat code lost its highlight surface').not.toBe(TRANSPARENT);
});
