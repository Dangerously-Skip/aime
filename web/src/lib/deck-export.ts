/**
 * Turn a generated deck into ONE file you can actually send someone.
 *
 * WHAT IS WRONG WITH THE DECK AS WRITTEN. It is 24KB of HTML that depends on
 * five stylesheets and a script referenced by ABSOLUTE path into the author's
 * home directory, plus its images by relative path:
 *
 *   <link href="/Users/adam/.claude/plugins/html-deck/assets/base.css">
 *   <img src="images/cover.png">
 *
 * Email that and the recipient gets unstyled text and broken images. It is not
 * shareable by ANY channel — not Slack, not AirDrop, not a USB stick — and every
 * deck leaks the author's username in half a dozen places.
 *
 * So this is the prerequisite for sharing, and it needs no infrastructure at
 * all: inline the stylesheets, inline the script, inline the images as data
 * URIs, emit a single file that works from a `file://` URL forever.
 *
 * ## The boundary, stated rather than implied
 *
 * The themes load their typefaces from Google Fonts with `@import url(https://
 * fonts.googleapis.com/…)`. Those are left alone, so an exported deck still
 * reaches the network for TYPOGRAPHY — offline it renders in fallback faces,
 * correctly laid out. Inlining them means fetching woff2 at export time, which
 * makes this impure, slow, and dependent on the exporting machine's network;
 * that is a separate feature, not a silent part of this one. `remoteFonts` is
 * reported so the caller can say so instead of the user discovering it on a
 * plane.
 *
 * ## Injected IO
 *
 * The readers are passed in: the whole transform is then a pure function of
 * (html, files) and testable without touching a disk, which matters because the
 * failure mode is a deck that LOOKS fine to whoever exported it — they have all
 * the files locally — and is broken for everyone else.
 */

/** Data-URI types for the images a deck can embed. */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

export interface BundleDeps {
  /** Absolute path → text, or null when it is not readable. */
  readText(absPath: string): string | null;
  /** Absolute path → bytes, or null when it is not readable. */
  readBinary(absPath: string): Uint8Array | null;
  /** Resolve `ref` (absolute, or relative to the deck) to an absolute path. */
  resolve(deckDir: string, ref: string): string;
}

export interface BundleResult {
  html: string;
  /** How many references were inlined — 0 means nothing was found to bundle. */
  inlined: number;
  /** References that could not be read. The deck still exports, minus these. */
  missing: string[];
  /** Remote URLs left as-is — the honest caveat for the caller to surface. */
  remoteFonts: string[];
}

/**
 * `</script>` inside inlined JS, or `</style>` inside inlined CSS, ends the
 * element early and dumps the rest of the file into the document as text.
 * The escape is legal in both: the parser looks for the literal sequence.
 */
function escapeForElement(content: string, tag: 'script' | 'style'): string {
  return content.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
}

const isRemote = (ref: string) => /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:');

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

/** Strip a `file://` prefix and any query or fragment a generator appended. */
function cleanRef(ref: string): string {
  return ref.replace(/^file:\/\//, '').split(/[?#]/)[0];
}

export function bundleDeck(html: string, deckPath: string, deps: BundleDeps): BundleResult {
  const deckDir = deckPath.replace(/[\\/][^\\/]*$/, '') || deckPath;
  const missing: string[] = [];
  const remoteFonts: string[] = [];
  let inlined = 0;

  const read = (ref: string): string | null => {
    const text = deps.readText(deps.resolve(deckDir, cleanRef(ref)));
    if (text === null) missing.push(ref);
    return text;
  };

  let out = html;

  // Stylesheets → <style>. Keeps the id so `runtime.js`'s theme switching,
  // which looks up `#theme-link`, does not throw on a bundled deck.
  out = out.replace(
    /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi,
    (tag) => {
      const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href || isRemote(href)) {
        if (href) remoteFonts.push(href);
        return tag;
      }
      const css = read(href);
      if (css === null) return tag;
      inlined++;
      const id = /\bid=["']([^"']+)["']/i.exec(tag)?.[1];
      const idAttr = id ? ` id="${id}"` : '';
      return `<style${idAttr} data-inlined-from="${escapeAttr(basename(href))}">\n${escapeForElement(css, 'style')}\n</style>`;
    },
  );

  // Scripts with a src → inline. `defer`/`async` are dropped with the tag,
  // which is correct: an inline script runs where it sits, and the deck's
  // runtime is loaded at the end of <body> already.
  out = out.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src: string) => {
    if (isRemote(src)) return tag;
    const js = read(src);
    if (js === null) return tag;
    inlined++;
    return `<script data-inlined-from="${escapeAttr(basename(src))}">\n${escapeForElement(js, 'script')}\n</script>`;
  });

  // Images → data URIs.
  out = out.replace(/\bsrc=["']([^"']+)["']/gi, (attr, ref: string) => {
    if (isRemote(ref) || !IMAGE_TYPES[extensionOf(ref)]) return attr;
    const bytes = deps.readBinary(deps.resolve(deckDir, cleanRef(ref)));
    if (!bytes) {
      missing.push(ref);
      return attr;
    }
    inlined++;
    const b64 = toBase64(bytes);
    return `src="data:${IMAGE_TYPES[extensionOf(ref)]};base64,${b64}"`;
  });

  // Anything the CSS itself pulls from the network — the Google Fonts imports.
  for (const m of out.matchAll(/@import\s+url\(\s*["']?(https?:\/\/[^"')]+)/gi)) {
    remoteFonts.push(m[1]);
  }

  return { html: out, inlined, missing, remoteFonts: [...new Set(remoteFonts)] };
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Does this export still name the machine it came from?
 *
 * A deck's `<link href>` carries `/Users/<name>/…`, so an export that failed to
 * inline something does not merely look wrong — it publishes the author's
 * username to whoever they send it to. Worth asserting rather than assuming,
 * since the export succeeds either way.
 */
export function leaksLocalPaths(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/(?:href|src)=["'](?:file:\/\/)?((?:\/Users\/|\/home\/|[A-Za-z]:\\)[^"']*)["']/gi)) {
    found.add(m[1]);
  }
  return [...found];
}

/** A filename for the exported deck: `my-deck.html` → `my-deck.share.html`. */
export function exportFileName(deckPath: string): string {
  const base = basename(deckPath).replace(/\.html?$/i, '');
  return `${base || 'deck'}.share.html`;
}
