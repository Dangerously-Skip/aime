import { describe, it, expect } from 'vitest';
import {
  prepareDeckForPreview,
  DECK_ASSET_ROUTE,
  looksLikeDeck,
  countSlides,
  ASSET_ROUTE,
} from './deck-preview';

/**
 * Making a generated deck viewable inside the app.
 *
 * The decks are written to be opened from disk, so they link their stylesheets
 * by absolute filesystem path. That resolves on `file://` and nowhere else — in
 * an iframe on an http origin every link fails silently and the deck renders as
 * unstyled text. Which would have looked like the theme never applied: the same
 * symptom, from a different cause, as the bug that got the theme wired up in the
 * first place.
 */

const DECK = `<!DOCTYPE html>
<html lang="en" data-theme="neo-brutalism">
<head>
<link rel="stylesheet" href="/Users/adamwitanowski/.claude/plugins/html-deck/assets/fonts.css">
<link rel="stylesheet" href="/Users/adamwitanowski/.claude/plugins/html-deck/assets/base.css">
<link rel="stylesheet" id="theme-link" href="/Users/adamwitanowski/.claude/plugins/html-deck/assets/themes/neo-brutalism.css">
<script src="/Users/adamwitanowski/.claude/plugins/html-deck/assets/runtime.js"></script>
</head>
<body><div class="deck">
<section class="slide is-active" data-title="Cover"><h1>Pizza</h1></section>
<section class="slide" data-title="Why"><h2>Why</h2></section>
</div></body></html>`;

describe('asset links are repointed at the app', () => {
  it('rewrites every html-deck asset reference', () => {
    const { html, rewritten } = prepareDeckForPreview(DECK);
    expect(rewritten, 'nothing was rewritten — the deck would render unstyled').toBe(4);
    expect(html).not.toContain('/Users/adamwitanowski');
    expect(html).toContain(`${ASSET_ROUTE}?file=base.css`);
    expect(html).toContain(`${ASSET_ROUTE}?file=themes%2Fneo-brutalism.css`);
  });

  it('rewrites the runtime script, not just the stylesheets', () => {
    // Without it the preview renders slide one and nothing responds, which
    // reads as broken rather than as a still image.
    expect(prepareDeckForPreview(DECK).html).toContain(`${ASSET_ROUTE}?file=runtime.js`);
  });

  /** The deck may have been generated on another machine, under another user. */
  it('does not depend on whose home directory it was written under', () => {
    const other = DECK.replace(/\/Users\/adamwitanowski/g, '/home/someone-else');
    expect(prepareDeckForPreview(other).rewritten).toBe(4);
  });

  it('handles a file:// scheme as well as a bare path', () => {
    const scheme = '<link href="file:///Users/x/.claude/plugins/html-deck/assets/base.css">';
    expect(prepareDeckForPreview(scheme).html).toContain(`${ASSET_ROUTE}?file=base.css`);
  });

  /**
   * An image the deck legitimately sourced from the web, or inlined, has to keep
   * working — rewriting is for the local assets that cannot resolve, not a
   * blanket rule about URLs.
   */
  it('leaves http and data URLs alone', () => {
    const withImg =
      '<img src="https://example.com/pizza.jpg"><img src="data:image/png;base64,AAA">';
    const { html, rewritten } = prepareDeckForPreview(withImg);
    expect(rewritten).toBe(0);
    expect(html).toBe(withImg);
  });

  /**
   * The rewritten path becomes a query parameter to a file-reading route. It is
   * containment-checked there too, but a traversal should never get that far —
   * and a deck has no legitimate reason to author one.
   */
  it('refuses to rewrite a traversal into the asset route', () => {
    const evil =
      '<link href="/Users/x/.claude/plugins/html-deck/assets/../../../../etc/passwd">';
    const { html, rewritten } = prepareDeckForPreview(evil);
    expect(rewritten, 'a traversal was rewritten into the asset route').toBe(0);
    expect(html).toBe(evil);
  });

  it('leaves an unrelated document untouched', () => {
    const page = '<html><body><h1>notes</h1></body></html>';
    expect(prepareDeckForPreview(page).html).toBe(page);
  });
});

describe('telling a deck from any other page', () => {
  it('recognises one of ours', () => {
    expect(looksLikeDeck(DECK)).toBe(true);
  });

  it('does not treat an arbitrary generated page as a deck', () => {
    // A prototype or a mockup is also `.html` and must not get slide chrome.
    expect(looksLikeDeck('<html><body><section class="hero">Landing</section></body></html>')).toBe(
      false,
    );
  });

  /** Linking the stylesheet is not enough — the structure is what runtime.js drives. */
  it('is not fooled by a page that merely links base.css', () => {
    expect(looksLikeDeck('<link href="/x/html-deck/assets/base.css"><body><p>hi</p></body>')).toBe(
      false,
    );
  });
});

describe('the slide count', () => {
  it('counts the slides that are actually there', () => {
    expect(countSlides(DECK)).toBe(2);
  });

  /**
   * Counted from markup rather than from `data-total`, which the model writes by
   * hand and has no reason to keep correct — the sample deck says 14 on a slide
   * that is one of two.
   */
  it('ignores a data-total the model got wrong', () => {
    const lying = DECK.replace('</div></body>', '<span data-total="99"></span></div></body>');
    expect(countSlides(lying)).toBe(2);
  });

  it('is zero for a page with no slides', () => {
    expect(countSlides('<html><body><p>hi</p></body></html>')).toBe(0);
  });
});

/**
 * The viewer's two halves used to contradict each other.
 *
 * The iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin` — a
 * deliberate choice, because the two together let framed content remove its own
 * sandbox and this HTML is model-written from web pages. The navigation code
 * then did `iframe.contentWindow.document.dispatchEvent(...)`, which is exactly
 * what an opaque origin forbids, so every click on "next" threw:
 *
 *   SecurityError: Blocked a frame with origin "http://localhost:19533"
 *   from accessing a cross-origin frame.
 *
 * The sandbox was never the thing to relax. Navigation crosses the boundary the
 * supported way instead.
 */
describe('the deck can be driven from outside the sandbox', () => {
  const prepared = () => prepareDeckForPreview(DECK).html;

  it('injects a shim that listens for the step message', () => {
    const html = prepared();
    expect(html, 'no bridge — the buttons have nothing to talk to').toContain('deck:step');
    expect(html).toMatch(/addEventListener\(\s*'message'/);
  });

  it('dispatches the key event INSIDE the frame, where it is same-origin', () => {
    expect(prepared()).toMatch(/document\.dispatchEvent\(new KeyboardEvent/);
  });

  /**
   * The counter reads the deck rather than a number the parent increments — a
   * second source of truth for "which slide is showing" is how the theme
   * previews drifted once already.
   */
  it('reports the real position back to the parent', () => {
    const html = prepared();
    expect(html).toContain('deck:position');
    expect(html).toMatch(/parent\.postMessage/);
    expect(html, 'position is not derived from is-active').toContain('is-active');
  });

  it('goes in last, after runtime.js has bound its handlers', () => {
    const html = prepared();
    expect(html.indexOf('deck:step')).toBeGreaterThan(html.indexOf('runtime.js'));
    expect(html).toMatch(/deck:step[\s\S]*<\/body>/);
  });

  /** An arbitrary generated page has no slides and gets no script injected. */
  it('is not added to a page that is not a deck', () => {
    const page = '<html><body><section class="hero">Landing</section></body></html>';
    expect(prepareDeckForPreview(page).html).not.toContain('deck:step');
  });
});

/**
 * The renderer side of the same contract. The bridge only helps if the viewer
 * stops reaching across the boundary — and reaching across is the natural thing
 * to write, which is why it was written once already.
 */
describe('the viewer never touches the frame’s document', () => {
  const src = () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('fs').readFileSync(
      require('path').resolve(__dirname, '../components/shared/file-renderers/html-renderer.tsx'),
      'utf-8',
    ) as string;

  it('does not read contentWindow.document', () => {
    const code = src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(
      code,
      'reaching into a sandboxed frame throws SecurityError on every click',
    ).not.toMatch(/contentWindow[?.\s]*\.\s*document/);
  });

  it('keeps the sandbox without allow-same-origin', () => {
    // Comments stripped first: the one explaining this rule necessarily names
    // the thing the rule forbids, which is exactly how this test failed on its
    // own file the first time it ran.
    const code = src().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).toMatch(/sandbox="allow-scripts"/);
    expect(code, 'the sandbox was relaxed instead of fixing navigation').not.toContain(
      'allow-same-origin',
    );
  });

  it('drives the deck by postMessage', () => {
    expect(src()).toMatch(/postMessage\(\s*\{\s*type:\s*"deck:step"/);
  });
});

/**
 * The deck's OWN images, which are not html-deck assets and were left pointing
 * at the app origin.
 *
 * `CreateImage` writes `<deck dir>/images/x.png` and the theme instruction has
 * the model embed `src="images/x.png"`. In the preview the deck is the `srcDoc`
 * of an iframe based on the app origin, so every one of those 404'd and each
 * generated picture rendered as a broken image — the other half of "there were
 * no images in the generated slide deck".
 */
describe('images written next to the deck', () => {
  const DECK_PATH = '/Users/me/work/deck.html';
  const withImage = (src: string) =>
    `<div class="deck"><section class="slide"><img src="${src}"></section></div>`;

  it('repoints a relative image at the deck-asset route', () => {
    const { html } = prepareDeckForPreview(withImage('images/cover.png'), DECK_PATH);
    expect(html).toContain(`${DECK_ASSET_ROUTE}?deck=`);
    expect(html).toContain(`file=${encodeURIComponent('images/cover.png')}`);
    expect(html, 'the raw relative path survived and would 404').not.toContain('src="images/cover.png"');
  });

  it('carries the deck path so the route knows what to contain the lookup to', () => {
    const { html } = prepareDeckForPreview(withImage('images/a.png'), DECK_PATH);
    expect(html).toContain(`deck=${encodeURIComponent(DECK_PATH)}`);
  });

  /*
   * Without a deck path there is no directory to resolve against, so the image
   * is left alone. Pointing it somewhere arbitrary would be worse than a broken
   * image: it would be a broken image plus a wrong request.
   */
  it('leaves relative images alone when it does not know where the deck is', () => {
    const { html } = prepareDeckForPreview(withImage('images/a.png'));
    expect(html).toContain('src="images/a.png"');
  });

  it.each([
    ['an inline data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a remote image', 'https://example.com/a.png'],
    ['a protocol-relative URL', '//example.com/a.png'],
    ['an absolute path', '/already/absolute.png'],
  ])('leaves %s untouched', (_label, src) => {
    const { html } = prepareDeckForPreview(withImage(src), DECK_PATH);
    expect(html).toContain(`src="${src}"`);
  });

  it('refuses to rewrite a path that climbs out of the deck folder', () => {
    const { html } = prepareDeckForPreview(withImage('../../etc/passwd.png'), DECK_PATH);
    expect(html, 'a traversal was handed to the route').not.toContain(DECK_ASSET_ROUTE);
  });

  it('still rewrites the html-deck stylesheets alongside', () => {
    const deck = `<link rel="stylesheet" href="/Users/me/.claude/plugins/html-deck/assets/base.css">${withImage('images/a.png')}`;
    const { html, rewritten } = prepareDeckForPreview(deck, DECK_PATH);
    expect(html).toContain(`${ASSET_ROUTE}?file=base.css`);
    expect(html).toContain(DECK_ASSET_ROUTE);
    expect(rewritten).toBe(2);
  });
});
