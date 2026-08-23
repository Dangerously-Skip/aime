import { test, expect } from '@playwright/test';
import {
  MARK_INTERACTIVE_JS,
  RESOLVE_REF_JS,
  ARIA_SNAPSHOT_SCRIPT,
} from '../src/lib/browser-tools';

/**
 * SNAPSHOT, THEN CLICK — the loop that has never once worked.
 *
 * Seven clicks across two real agent runs, seven failures, while every
 * index-free tool succeeded. The cause was two pieces of JavaScript that never
 * met: the only script that stamped element addresses was imported by one file
 * the agent path never called, and `snapshot` returned an accessibility tree
 * with no addresses in it at all.
 *
 * The unit tests for this run in jsdom, which does not lay pages out — every
 * rect is 0x0 and has to be stubbed, which is precisely the input the marking
 * script filters on. So they prove the pieces fit; they cannot prove the thing
 * works on a page a browser actually rendered.
 *
 * This runs the REAL exported scripts in REAL Chromium against a laid-out page,
 * and does the whole round trip: snapshot → read a ref out of the text the model
 * would see → resolve it → click it → observe the page change. That is the
 * agent's actual loop, and nothing below the model is faked.
 */

/*
 * A page with the shapes that broke it: nested roles, hidden nodes — and TEXT
 * NESTED INSIDE its interactive element, because that is how real markup is
 * written and the text-only version hid a serious bug.
 *
 * A "leaves only" label rule gave a button with a span inside it NO label at
 * all, so the model saw an unlabelled button and could not tell what it did.
 * This suite passed throughout, because its fixture was unrealistic. Note also
 * that HTML comments cannot go in this template: `<!--` and `-->` are legacy
 * comment syntax in JavaScript and silently break the parse.
 */
const PAGE = `<!doctype html>
<html><body>
  <h1>Camera listings</h1>
  <nav><a href="#one" id="first">Nikon FM</a></nav>
  <main>
    <ul>
      <li><a href="#two"><span>Bessaflex TM</span></a></li>
      <li><button id="bid" onclick="document.title='BID PLACED'"><span>Place bid</span></button></li>
    </ul>
    <input id="q" aria-label="Search listings" />
    <select id="sort"><option value="roi">ROI</option><option value="price">Price</option></select>
  </main>
  <button style="display:none" id="ghost">Hidden</button>
  <span style="visibility:hidden"><button id="tiny">Invisible</button></span>
</body></html>`;

test.describe('the ref round trip, in a real engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(PAGE);
  });

  test('a snapshot prints refs that resolve and click', async ({ page }) => {
    // 1. SNAPSHOT — exactly what the `snapshot` tool returns to the model.
    const tree = (await page.evaluate(ARIA_SNAPSHOT_SCRIPT)) as string;

    expect(tree, 'the tree must name what it describes').toMatch(/ref=\d+:\d+/);
    expect(tree).toMatch(/^Snapshot \d+ — \d+ interactive elements/);

    // 2. READ A REF the way a model would: find the line, take its ref.
    const bidLine = tree.split('\n').find((l) => /\[button\]/.test(l) && /Place bid/.test(l));
    expect(bidLine, 'the button is missing from the tree').toBeTruthy();
    const ref = /ref=(\d+:\d+)/.exec(bidLine!)?.[1];
    expect(ref, 'the button line carries no ref — the original bug').toBeTruthy();

    /*
     * ONE LINE PER THING. Container roles used to borrow their subtree's text,
     * so main > ul > li > button produced four lines all reading "Place bid"
     * with a ref on only one — three wrong answers to "which do I click?".
     * Found by reading this output in a real engine.
     */
    const sayingBid = tree.split('\n').filter((l) => /Place bid/.test(l));
    expect(sayingBid, 'the label is repeated up the ancestor chain').toHaveLength(1);

    /*
     * AND IT IS ON THE BUTTON. Both halves matter and they pull in opposite
     * directions: containers must not borrow their subtree's text, while a
     * button must take its name FROM its content however deeply nested. The
     * ARIA "name from content" role set is exactly that line.
     */
    expect(bidLine, 'the button line has a ref but no label').toMatch(/\[button\] "Place bid"/);

    // 3. RESOLVE + CLICK, the way the `click` tool does.
    const result = await page.evaluate(
      ([js, r]) => {
        const fn = new Function('ref', `${js}; return resolveRef(ref);`) as (
          ref: string,
        ) => { el: HTMLElement | null; why: string | null };
        const found = fn(r);
        if (!found.el) return { ok: false, why: found.why };
        found.el.click();
        return { ok: true, why: null };
      },
      [RESOLVE_REF_JS, ref!] as const,
    );

    expect(result.why).toBeNull();
    expect(result.ok).toBe(true);

    // 4. THE PAGE ACTUALLY MOVED. Not "the call returned success" — the click
    //    landed on the element the ref named and its handler ran.
    await expect(page).toHaveTitle('BID PLACED');
  });

  test('refs skip what cannot be clicked', async ({ page }) => {
    const tree = (await page.evaluate(ARIA_SNAPSHOT_SCRIPT)) as string;
    const heading = tree.split('\n').find((l) => /\[heading\]/.test(l));
    expect(heading, 'no heading in the tree').toBeTruthy();
    // A ref on a heading invites a click that can only fail.
    expect(heading).not.toMatch(/ref=/);
  });

  test('hidden and zero-size elements are not offered', async ({ page }) => {
    // Real layout, real computed styles — the thing jsdom cannot give us.
    const marked = await page.evaluate(
      (js) => {
        const fn = new Function(`${js}; markInteractive(); return {
          ghost: !!document.getElementById('ghost').getAttribute('data-agent-ref'),
          tiny: !!document.getElementById('tiny').getAttribute('data-agent-ref'),
          bid: !!document.getElementById('bid').getAttribute('data-agent-ref'),
        };`) as () => { ghost: boolean; tiny: boolean; bid: boolean };
        return fn();
      },
      MARK_INTERACTIVE_JS,
    );
    expect(marked.bid).toBe(true);
    expect(marked.ghost, 'display:none was offered').toBe(false);
    expect(marked.tiny, 'a visibility:hidden element was offered').toBe(false);
  });

  test('a stale ref REFUSES rather than clicking the wrong element', async ({ page }) => {
    /*
     * The safety property, demonstrated rather than asserted about. The
     * literature's example is a Cancel button that becomes a Delete button at
     * the same index after a re-render; here the same slot changes identity and
     * the old ref must not reach the new occupant.
     */
    const first = (await page.evaluate(ARIA_SNAPSHOT_SCRIPT)) as string;
    const line = first.split('\n').find((l) => /Place bid/.test(l))!;
    const staleRef = /ref=(\d+:\d+)/.exec(line)![1];

    // The page re-renders and that button becomes something destructive.
    await page.evaluate(() => {
      const b = document.getElementById('bid')!;
      b.textContent = 'DELETE EVERYTHING';
      b.setAttribute('onclick', "document.title='DELETED'");
    });
    await page.evaluate(ARIA_SNAPSHOT_SCRIPT); // a new snapshot; version moves on

    const result = await page.evaluate(
      ([js, r]) => {
        const fn = new Function('ref', `${js}; return resolveRef(ref);`) as (
          ref: string,
        ) => { el: HTMLElement | null; why: string | null };
        const found = fn(r);
        if (!found.el) return { clicked: false, why: found.why };
        found.el.click();
        return { clicked: true, why: null };
      },
      [RESOLVE_REF_JS, staleRef] as const,
    );

    expect(result.clicked, 'a stale ref clicked something').toBe(false);
    expect(result.why).toMatch(/page changed under you/i);
    // The destructive handler never ran.
    await expect(page).not.toHaveTitle('DELETED');
  });

  test('refs survive being read back out of a fresh snapshot', async ({ page }) => {
    // Re-snapshotting is the prescribed recovery, so it has to actually work.
    await page.evaluate(ARIA_SNAPSHOT_SCRIPT);
    const second = (await page.evaluate(ARIA_SNAPSHOT_SCRIPT)) as string;
    const refs = [...second.matchAll(/ref=(\d+:\d+)/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(2);

    const allResolve = await page.evaluate(
      ([js, list]) => {
        const fn = new Function('ref', `${js}; return resolveRef(ref);`) as (
          ref: string,
        ) => { el: HTMLElement | null };
        return (list as string[]).every((r) => !!fn(r).el);
      },
      [RESOLVE_REF_JS, refs] as const,
    );
    expect(allResolve, 'a ref from the newest snapshot did not resolve').toBe(true);
  });
});
