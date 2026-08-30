import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * THE DECK ACTUALLY MOVES — buttons, keys, and the class on the slide.
 *
 * Reported as "the <> buttons aren't moving the slide, arrow keys don't move
 * it, clicking doesn't move it — but when I open it in a browser the arrow keys
 * work." That last clause is the whole diagnosis and I spent three rounds on
 * focus and key handling before acting on it. All three inputs dying together,
 * while the same file works from disk, says the FRAME is not acting — the
 * parent was delivering the event correctly the entire time.
 *
 * `runtime.js` writes the current slide into the URL. The preview frame is
 * `srcdoc`, sandboxed without `allow-same-origin`, so its origin is `null` and
 * `history.replaceState` throws — in the MIDDLE of `goTo()`, abandoning the
 * rest of the navigation. A `file://` document has a real origin, which is
 * exactly why opening it directly worked.
 *
 * Asserted on the DOM inside the frame, not on the position message: the
 * message is our own bridge reporting, and the thing that was broken is whether
 * the deck itself moved.
 */

const REAL_DECK = path.join(
  process.env.HOME ?? '',
  '.aime/scratch/cc12b9f2-7809-4b1d-b54c-c5dc4e572624/kusama-presentation.html',
);

/** Stands in for the real deck on a machine that does not have it (CI). */
const SYNTHETIC = `<html><head>
<link rel="stylesheet" href="/Users/x/.claude/plugins/html-deck/assets/base.css">
<script src="/Users/x/.claude/plugins/html-deck/assets/runtime.js"></script>
</head><body><div class="deck">
<section class="slide is-active"><h1>One</h1></section>
<section class="slide"><h1>Two</h1></section>
<section class="slide"><h1>Three</h1></section>
</div></body></html>`;

const rawDeck = () => (fs.existsSync(REAL_DECK) ? fs.readFileSync(REAL_DECK, 'utf8') : SYNTHETIC);

async function boot(page: Page) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    'aime:settings',
    JSON.stringify({ state: { onboardingComplete: true }, version: 6 }),
  ]);
  await page.goto('/');
  await expect(page.getByText('New Chat').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Mount the prepared deck in a frame sandboxed exactly as the app does, step it,
 * and report which slide the DECK thinks is active plus anything it threw.
 */
async function driveDeck(page: Page, html: string, steps: number) {
  return page.evaluate(
    async ({ html, steps }) => {
      const errors: string[] = [];
      const probe = `<script>window.onerror=function(m){parent.postMessage({deckError:String(m)},'*')};<\/script>`;
      const readback = `<script>addEventListener('message',function(e){
        if((e.data||{}).type!=='deck:probe')return;
        var s=document.querySelectorAll('.slide');
        var i=0; for(var k=0;k<s.length;k++) if(s[k].classList.contains('is-active')) { i=k; break; }
        parent.postMessage({activeIndex:i},'*');
      });<\/script>`;

      let active = -1;
      const onMsg = (e: MessageEvent) => {
        const d = (e.data || {}) as Record<string, unknown>;
        if (typeof d.deckError === 'string') errors.push(d.deckError);
        if (typeof d.activeIndex === 'number') active = d.activeIndex as number;
      };
      window.addEventListener('message', onMsg);

      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = html.replace(/(<body[^>]*>)/i, `$1${probe}`).replace('</body>', `${readback}</body>`);
      f.style.cssText = 'width:800px;height:450px';
      document.body.appendChild(f);
      await new Promise((r) => setTimeout(r, 3000));

      for (let i = 0; i < steps; i++) {
        f.contentWindow!.postMessage({ type: 'deck:step', delta: 1 }, '*');
        await new Promise((r) => setTimeout(r, 700));
      }
      f.contentWindow!.postMessage({ type: 'deck:probe' }, '*');
      await new Promise((r) => setTimeout(r, 400));

      window.removeEventListener('message', onMsg);
      f.remove();
      return { active, errors };
    },
    { html, steps },
  );
}

test('stepping twice moves the deck two slides', async ({ page }) => {
  await boot(page);
  const { prepareDeckForPreview } = await import('../src/lib/deck-preview');
  const prepared = prepareDeckForPreview(rawDeck(), REAL_DECK).html;

  const { active, errors } = await driveDeck(page, prepared, 2);

  expect(errors, `the deck threw: ${errors.join(' | ')}`).toEqual([]);
  expect(active, 'the deck did not move — this is the reported bug').toBe(2);
});

/*
 * THERE IS NO "without the shim it stalls" TEST, and there was one for a while.
 *
 * The history SecurityError is real — `runtime.js` calls `replaceState` in the
 * middle of `goTo()`, and an origin-less frame refuses it — but removing the
 * shim still reaches slide 2 cleanly here. The throw costs the entry animations
 * that follow it, not the navigation.
 *
 * So the shim is a genuine but SMALLER fix, and a test asserting it was the
 * cause would have encoded a wrong diagnosis as a passing check. What actually
 * made the deck inert is the frame being unable to load `runtime.js` at all,
 * and that does not reproduce in Chromium — see `deck-inline-assets.ts` for the
 * measurement taken against the real app.
 */
