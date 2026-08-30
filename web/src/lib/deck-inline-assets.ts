/**
 * Carry a deck's stylesheets and runtime INTO the preview frame.
 *
 * WHY THIS EXISTS, measured rather than reasoned. The deck preview runs in an
 * iframe that is `srcdoc` and sandboxed WITHOUT `allow-same-origin` — on
 * purpose, because deck HTML is model-written from web pages. Its assets were
 * rewritten to `/api/themes/asset`, which requires the local session cookie.
 *
 * In Electron that frame cannot fetch it. Driving the real app over CDP:
 *
 *     parent fetch runtime.js          -> 200
 *     sandboxed frame fetch runtime.js -> threw: Failed to fetch
 *
 * A script that fails to LOAD does not reach `window.onerror`, so nothing
 * anywhere reported it. `runtime.js` simply never ran, no slide ever got
 * `is-active`, and the deck was inert: the buttons posted `deck:step`, the
 * bridge dispatched a real keydown, and there was no listener on the other end.
 * Buttons, arrow keys and clicks all died together — which is exactly the shape
 * that should have told me it was never about focus. Opening the same file from
 * disk worked because it loads its assets from the filesystem.
 *
 * The same measurement confirms the fix: with all five assets inlined, the deck
 * reports `active=0` on load and `active=1` after one step, in Electron, with
 * the user's own 15-slide deck.
 *
 * PLAYWRIGHT COULD NOT HAVE CAUGHT THIS. The identical frame, built the same
 * way against the same server, fetches its assets happily in Chromium. The
 * difference is Electron's handling of a same-site cookie from an opaque
 * origin, so only the real app shows it — which is why this is verified there.
 */

/** `href`/`src` pointing at the credentialed theme-asset route. */
const LINKED_ASSET = /(?:href|src)="(\/api\/themes\/asset\?file=[^"]+)"/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every distinct asset URL the prepared deck links to. */
export function linkedAssetUrls(html: string): string[] {
  return [...new Set([...html.matchAll(LINKED_ASSET)].map((m) => m[1]))];
}

/**
 * Replace each `<link>`/`<script src>` with the file's actual contents.
 *
 * `fetchText` is injected so this is testable without a server, and so the
 * caller decides the credentialed context — which is the whole point: the
 * PARENT holds the cookie, the frame does not.
 *
 * An asset that cannot be fetched is left as a link rather than dropped. That
 * may still work (it does in a browser), and a deck missing a stylesheet is
 * more use than a deck missing a whole tag.
 */
export async function inlineDeckAssets(
  html: string,
  fetchText: (url: string) => Promise<string>,
): Promise<string> {
  const urls = linkedAssetUrls(html);
  if (urls.length === 0) return html;

  const texts = await Promise.all(
    // `&amp;` because the URL came out of an HTML attribute.
    urls.map((u) => fetchText(u.replace(/&amp;/g, '&')).catch(() => null)),
  );

  let out = html;
  urls.forEach((url, i) => {
    const text = texts[i];
    if (text === null) return;
    const esc = escapeRegExp(url);
    out = out
      .replace(new RegExp(`<link[^>]*href="${esc}"[^>]*>`, 'g'), () => `<style>${text}</style>`)
      .replace(
        new RegExp(`<script[^>]*src="${esc}"[^>]*></script>`, 'g'),
        () => `<script>${text}</script>`,
      );
  });
  return out;
}
