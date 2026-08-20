import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/*
 * The Code surface's dockview overrides have now failed to apply TWICE, both
 * times silently, both times only noticed from a screenshot:
 *
 *   1. Every variable was written `hsl(var(--primary))` while the app's tokens
 *      are hex. `hsl()` needs a triplet, so all 51 declarations were invalid and
 *      the browser discarded them.
 *   2. The fix for (1) was hung off `.dockview-theme-abyss-spaced.dv-workspace`
 *      — a COMPOUND selector for one element carrying both classes. No such
 *      element exists: `dv-workspace` is our wrapper, and dockview puts the
 *      theme class on a shell it creates inside. Custom properties inherit, but
 *      a declaration on an element beats one inherited from an ancestor, so
 *      dockview's navy won the entire subtree.
 *
 * Both were valid CSS that applied to nothing, which no typecheck, lint or unit
 * test can see. The only thing that can is asking a browser what it actually
 * computed — so that is what this does, against the real DOM shape and the real
 * two stylesheets in the real cascade order.
 *
 * It deliberately asserts a RENDERED colour, not just a variable: a variable can
 * hold the right value and still be read by nothing.
 */

const dockviewCss = readFileSync('node_modules/dockview/dist/styles/dockview.css', 'utf8');
const overrideCss = readFileSync(
  'src/components/surfaces/code/workspace/workspace-dockview.css',
  'utf8',
);
/*
 * globals.css IS PART OF THE CASCADE AND LEAVING IT OUT MADE THIS FILE LIE.
 *
 * The harness used to declare a handful of tokens inline and load only
 * dockview's stylesheet and ours. That was fine until `--panel-surface` moved
 * into globals.css (DR-20 D-4). After that, `var(--panel-surface)` resolved to
 * nothing here, `.groupview`'s background became `rgba(0, 0, 0, 0)`, and the
 * "panels are darker than the chrome" test PASSED — because transparent has a
 * luminance of 0, and 0 is less than anything.
 *
 * So the test was green precisely when the panels were invisible. Sampled from
 * a screenshot of that state, every pixel of the Code surface was #262624: the
 * app background, showing through panels that were not painting at all.
 *
 * Loading the real stylesheet is the fix; the explicit transparency assertion
 * below is the belt.
 */
const globalsCss = readFileSync('src/app/globals.css', 'utf8');

/** dockview's own abyss palette — the colours that must NOT survive. */
const ABYSS = ['#10192c', '#000c18', '#1c1c2a', '#2b2b4a'];

/** Stand-ins for the app's dark tokens; only the shape matters here. */
const TOKENS = {
  background: '#262624',
  card: '#303032',
  border: '#413A34',
  primary: '#D97756',
};

const harness = `<!doctype html><html class="dark"><head>
<style>${globalsCss}</style>
<style>:root{
  --background:${TOKENS.background};--card:${TOKENS.card};--muted:#332E2B;
  --border:${TOKENS.border};--primary:${TOKENS.primary};
  --foreground:#eee;--muted-foreground:#999;
}</style>
<style>${dockviewCss}</style>
<style>${overrideCss}</style>
</head><body>
<div class="dv-workspace">
  <div class="dockview-theme-abyss-spaced dv-shell">
    <div class="dv-dockview">
      <div class="groupview" id="inactiveGroup"><div class="tabs-container"></div></div>
      <div class="groupview dv-active-group" id="group">
        <div class="tabs-container">
          <div class="tab dv-active-tab" id="active">Files</div>
          <div class="tab" id="inactive">Editor</div>
        </div>
      </div>
    </div>
  </div>
</div></body></html>`;

test.describe('Code surface dockview theme', () => {
  test('the app palette wins over dockview’s built-in abyss', async ({ page }) => {
    await page.setContent(harness);

    const read = await page.evaluate(() => {
      const shell = document.querySelector('.dockview-theme-abyss-spaced')!;
      const cs = getComputedStyle(shell);
      return {
        abyss: cs.getPropertyValue('--dv-color-abyss').trim().toLowerCase(),
        abyssDark: cs.getPropertyValue('--dv-color-abyss-dark').trim().toLowerCase(),
        // The one that matters: what the panel is actually painted.
        groupBackground: getComputedStyle(document.getElementById('group')!).backgroundColor,
      };
    });

    for (const navy of ABYSS) {
      expect(read.abyss, 'dockview abyss palette leaked into the panels').not.toBe(navy);
      expect(read.abyssDark).not.toBe(navy);
    }

    /*
     * Assert the PROPERTY, not a hex. The first version pinned rgb(48,48,50)
     * and broke the moment the panels were deliberately darkened — a test that
     * fails on intended design changes teaches people to edit the test.
     *
     * What must stay true is that the surface comes from this app's warm
     * neutral palette. Every abyss colour is blue-dominant (#10192c is B44 vs
     * R16); every token here is not.
     */
    const [r, g, b] = read.groupBackground.match(/\d+/g)!.map(Number);
    expect(b, `panel ${read.groupBackground} is blue-dominant — abyss is leaking`)
      .toBeLessThanOrEqual(Math.max(r, g) + 3);
  });

  test('the active tab has no curved underline', async ({ page }) => {
    /*
     * An inset bottom box-shadow follows the border radius, so on a rounded tab
     * it renders as a smile hugging the corners rather than an underline. The
     * pill fill is the indicator instead; focus moved to the group ring.
     */
    await page.setContent(harness);
    const shadow = await page.evaluate(
      () => getComputedStyle(document.getElementById('active')!).boxShadow,
    );
    expect(shadow === 'none' || !shadow.includes('inset')).toBe(true);
  });

  test('the active tab is still distinguishable from an inactive one', async ({ page }) => {
    // Removing the stroke must not remove the signal — otherwise the fix for
    // one complaint quietly creates another.
    await page.setContent(harness);
    const { active, inactive } = await page.evaluate(() => {
      const g = (id: string) => getComputedStyle(document.getElementById(id)!);
      return {
        active: { bg: g('active').backgroundColor, weight: g('active').fontWeight },
        inactive: { bg: g('inactive').backgroundColor, weight: g('inactive').fontWeight },
      };
    });
    expect(active.bg).not.toBe(inactive.bg);
    expect(Number(active.weight)).toBeGreaterThan(Number(inactive.weight));
  });

  test('panels are DARKER than the surrounding chrome, not lighter', async ({ page }) => {
    /*
     * At `--card` the panels were #303032 sitting inside #262624 chrome — a
     * panel lighter than the frame holding it, which read as inflated rather
     * than inset. They should be wells.
     */
    await page.setContent(harness);
    /*
     * Two serialisations, and the naive one silently lies. A plain colour comes
     * back `rgb(38, 38, 36)`, but anything produced by `color-mix` comes back
     * `color(srgb 0.1043 0.1043 0.0988)` — floats in 0..1. Matching /\d+/ on
     * that yields [0, 1043, 0, 1043, 0, 988] and a luminance of 74605, which is
     * how the first version of this test "failed" against correct CSS.
     */
    const lum = (c: string) => {
      const nums = (c.match(/[\d.]+/g) ?? []).map(Number);
      const [r, g, b] = c.startsWith('color(') ? nums.map((n) => n * 255) : nums;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const { panel, chrome } = await page.evaluate(() => ({
      panel: getComputedStyle(document.getElementById('group')!).backgroundColor,
      chrome: getComputedStyle(document.querySelector('.dv-dockview')!).backgroundColor,
    }));
    expect(lum(panel), `panel ${panel} should be darker than chrome ${chrome}`)
      .toBeLessThan(lum(chrome));
  });

  test('panel edges blend into the gutter rather than ruling a grid', async ({ page }) => {
    // Three panels each outlined in `--border` tile into column and row rules
    // across the surface. The border keeps its 1px so nothing reflows; it is
    // simply painted the gutter colour.
    await page.setContent(harness);
    const { border, chrome } = await page.evaluate(() => ({
      border: getComputedStyle(document.getElementById('inactiveGroup')!).borderTopColor,
      chrome: getComputedStyle(document.querySelector('.dv-dockview')!).backgroundColor,
    }));
    expect(border).toBe(chrome);
  });

  test('panel spacing comes from one place, not two', async ({ page }) => {
    // The `-spaced` themes ship 10px and we add 6px; 16px of frame is what read
    // as a heavy gutter. The theme's contribution is zeroed.
    await page.setContent(harness);
    const spacing = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.dockview-theme-abyss-spaced')!)
        .getPropertyValue('--dv-spacing-padding')
        .trim(),
    );
    expect(spacing).toBe('0px');
  });

  test('the panel is PAINTED — not transparent', async ({ page }) => {
    /*
     * The assertion the luminance check could not make. A transparent panel is
     * "darker than the chrome" by every numeric test and completely invisible
     * on screen, which is exactly the state that shipped and had to be caught
     * from a screenshot instead.
     */
    await page.setContent(harness);
    const bg = await page.evaluate(
      () => getComputedStyle(document.getElementById('group')!).backgroundColor,
    );
    expect(bg, 'the panel has no background — --panel-surface is not resolving').not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    expect(bg).not.toBe('transparent');
  });
});