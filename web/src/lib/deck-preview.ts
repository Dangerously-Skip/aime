/**
 * Make a generated HTML deck viewable inside the app.
 *
 * The decks the agent writes are self-contained files meant to be opened from
 * disk, so they link their stylesheets by ABSOLUTE filesystem path:
 *
 *   <link rel="stylesheet" href="/Users/you/.claude/plugins/html-deck/assets/base.css">
 *
 * That works in a browser opened on `file://` and nowhere else. Dropped into an
 * iframe on an http origin, every one of those links fails silently and the deck
 * renders as unstyled text — which looks like the theme was never applied, the
 * exact complaint that started this. So the paths are rewritten to the app's own
 * asset route before the HTML reaches the iframe.
 *
 * Rewriting rather than serving the plugins directory is deliberate: the route
 * it points at is an allowlisted, containment-checked reader over the vendored
 * assets. A general "serve any file the deck references" endpoint would be a
 * file-read primitive driven by model-authored HTML.
 */

/** Where the rewritten stylesheets and scripts are fetched from. */
export const ASSET_ROUTE = '/api/themes/asset';

/** Where images written NEXT TO the deck are fetched from. */
export const DECK_ASSET_ROUTE = '/api/deck/asset';

/**
 * A relative `src` — the deck's own generated images.
 *
 * `CreateImage` writes `<deck dir>/images/x.png` and `themeInstruction` tells
 * the model to embed it as `src="images/x.png"`. Correct for a file opened from
 * disk; in the preview the deck is the `srcDoc` of an iframe whose base URL is
 * the APP ORIGIN, so each of those requested `http://localhost:PORT/images/…`
 * and 404'd — every picture in a themed deck showed as broken.
 *
 * Deliberately excludes anything already absolute (`/`, `http:`, `data:`,
 * `file:`): an inline data URI works as-is, and an absolute filesystem path is
 * the stylesheet case `ASSET_REF` already handles.
 */
const RELATIVE_IMG = /\bsrc\s*=\s*"(?!(?:[a-z]+:|\/\/|\/|#))([^"]+)"/gi;

/**
 * Matches an html-deck asset reference however it was written — with or without
 * a `file://` scheme, and under any home directory, since the path is absolute
 * to whoever generated it and the viewer may not be the same machine.
 */
const ASSET_REF = /(href|src)\s*=\s*"(?:file:\/\/)?[^"]*?\/html-deck\/assets\/([^"]+)"/g;

/** `..` in a deck-authored path has no legitimate use and is not repaired. */
function safeRelative(rel: string): string | null {
  if (rel.includes('..') || rel.startsWith('/')) return null;
  // Strip a query or fragment the author may have appended.
  const clean = rel.split(/[?#]/)[0];
  return /^[\w./-]+$/.test(clean) ? clean : null;
}

export interface PreparedDeck {
  html: string;
  /** How many asset links were repointed — 0 means this is probably not a deck. */
  rewritten: number;
}

/**
 * The only way the viewer can drive the deck.
 *
 * The preview iframe is `sandbox="allow-scripts"` WITHOUT `allow-same-origin`,
 * which makes it an opaque origin — the parent cannot touch
 * `iframe.contentWindow.document` at all. The first version of the viewer tried
 * to, and every click on "next" threw:
 *
 *   SecurityError: Blocked a frame with origin "http://localhost:19533"
 *   from accessing a cross-origin frame.
 *
 * The sandbox is not the thing to relax — `allow-scripts` together with
 * `allow-same-origin` lets framed content remove its own sandbox, and this HTML
 * was written by a model out of web content. So navigation crosses the boundary
 * the way it is meant to: `postMessage` in, and this shim dispatches the key
 * event INSIDE the frame, where it is same-origin with itself and `runtime.js`
 * picks it up as though the user had pressed a key.
 *
 * It also posts the current position back, so the counter reflects the deck
 * rather than a number the parent keeps separately — a second source of truth
 * for "which slide is showing" is how the theme previews once drifted.
 */
const BRIDGE = `<script>(function(){
  function total(){ return document.querySelectorAll('.slide').length; }
  function index(){
    var s = document.querySelectorAll('.slide');
    for (var i = 0; i < s.length; i++) if (s[i].classList.contains('is-active')) return i;
    return 0;
  }
  function report(){
    try { parent.postMessage({ type: 'deck:position', index: index(), total: total() }, '*'); } catch (e) {}
  }
  addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type !== 'deck:step') return;
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: d.delta > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true,
    }));
    // After runtime.js has moved the active slide, not before.
    setTimeout(report, 0);
  });
  addEventListener('load', report);
  document.addEventListener('keydown', function(){ setTimeout(report, 0); });
})();<\/script>`;

/** Insert the shim last, so `runtime.js` has already bound its handlers. */
function withBridge(html: string): string {
  return html.includes('</body>')
    ? html.replace(/<\/body>/i, `${BRIDGE}</body>`)
    : html + BRIDGE;
}

/**
 * Rewrite a deck's asset links so it renders in an iframe on the app's origin.
 *
 * Leaves http(s) and data URLs alone: an image the deck legitimately sourced
 * from the web, or inlined, must keep working.
 */
/**
 * @param deckPath where the deck itself lives, when the caller knows. Only with
 *   it can a relative `src` be resolved — the route needs a directory to
 *   contain the lookup to, and without one the image is left alone rather than
 *   pointed somewhere arbitrary.
 */
export function prepareDeckForPreview(html: string, deckPath?: string): PreparedDeck {
  let rewritten = 0;
  let out = html.replace(ASSET_REF, (whole, attr: string, rel: string) => {
    const safe = safeRelative(rel);
    if (!safe) return whole;
    rewritten++;
    return `${attr}="${ASSET_ROUTE}?file=${encodeURIComponent(safe)}"`;
  });

  if (deckPath) {
    out = out.replace(RELATIVE_IMG, (whole, rel: string) => {
      const safe = safeRelative(rel);
      if (!safe) return whole;
      rewritten++;
      return `src="${DECK_ASSET_ROUTE}?deck=${encodeURIComponent(deckPath)}&file=${encodeURIComponent(safe)}"`;
    });
  }
  // Only decks get the navigation shim; an arbitrary generated page has no
  // slides to step through and should not have a script injected into it.
  return { html: looksLikeDeck(out) ? withBridge(out) : out, rewritten };
}

/**
 * Is this HTML one of our decks, rather than an arbitrary page the agent wrote?
 *
 * Used to choose between the deck viewer and a plain preview. Keyed on the
 * structural class names `base.css` and `runtime.js` depend on, because those
 * are what make the slide chrome work — a page without them is not a deck even
 * if it links the stylesheet.
 */
export function looksLikeDeck(html: string): boolean {
  return /<section[^>]*class="[^"]*\bslide\b/.test(html) && /class="deck"/.test(html);
}

/**
 * How many slides the deck has, for the viewer's counter.
 *
 * Counted from the markup rather than trusting `data-total`, which the model
 * writes by hand and has no reason to keep correct.
 */
export function countSlides(html: string): number {
  return [...html.matchAll(/<section[^>]*class="[^"]*\bslide\b/g)].length;
}
