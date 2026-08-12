import { describe, it, expect } from 'vitest';
import { bundleDeck, leaksLocalPaths, exportFileName, type BundleDeps } from './deck-export';

/**
 * A generated deck is not shareable by ANY channel — not email, not Slack, not
 * AirDrop. It links five stylesheets and a script by absolute path into the
 * author's home directory and its images relatively, so the recipient gets
 * unstyled text and broken pictures, and every deck leaks the author's
 * username.
 *
 * The IO is injected so this is a pure function of (html, files): the failure
 * mode is a deck that looks perfect to whoever exported it, because they have
 * all the files locally, and is broken for everyone else.
 */
const files: Record<string, string> = {
  '/plugins/assets/base.css': '.slide { color: red }',
  '/plugins/assets/themes/magazine-bold.css': "@import url('https://fonts.googleapis.com/css2?family=Playfair');\n.deck { font-family: Playfair }",
  '/plugins/assets/runtime.js': 'document.addEventListener("keydown", () => {});',
  '/w/images/cover.png': 'PNGDATA',
};

const deps = (over: Partial<BundleDeps> = {}): BundleDeps => ({
  readText: (p) => files[p] ?? null,
  readBinary: (p) => (files[p] ? new TextEncoder().encode(files[p]) : null),
  // Mirrors node's path.resolve closely enough for these cases.
  resolve: (dir, ref) => (ref.startsWith('/') ? ref : `${dir}/${ref}`.replace(/\/\.\//g, '/')),
  ...over,
});

const DECK = '/w/deck.html';
const HTML = [
  '<html><head>',
  '<link rel="stylesheet" href="/plugins/assets/base.css">',
  '<link rel="stylesheet" id="theme-link" href="/plugins/assets/themes/magazine-bold.css">',
  '</head><body>',
  '<div class="deck"><section class="slide"><img src="images/cover.png"></section></div>',
  '<script src="/plugins/assets/runtime.js"></script>',
  '</body></html>',
].join('\n');

describe('bundleDeck', () => {
  it('inlines the stylesheets', () => {
    const { html } = bundleDeck(HTML, DECK, deps());
    expect(html).toContain('.slide { color: red }');
    expect(html, 'a stylesheet link survived and would 404 for the recipient').not.toContain(
      '<link rel="stylesheet"',
    );
  });

  it('inlines the script', () => {
    const { html } = bundleDeck(HTML, DECK, deps());
    expect(html).toContain('document.addEventListener');
    expect(html).not.toMatch(/<script[^>]*\bsrc=/);
  });

  it('inlines the images as data URIs', () => {
    const { html } = bundleDeck(HTML, DECK, deps());
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain('src="images/cover.png"');
  });

  /*
   * The reason this matters beyond aesthetics: an un-inlined reference carries
   * `/Users/<name>/…` to whoever the deck is sent to.
   */
  it('leaves no local filesystem path behind', () => {
    const withHome = HTML.replace(/\/plugins\/assets/g, '/Users/adam/.claude/plugins/html-deck/assets');
    const homeFiles: BundleDeps = deps({
      readText: (p) => files[p.replace('/Users/adam/.claude/plugins/html-deck/assets', '/plugins/assets')] ?? null,
    });
    const { html } = bundleDeck(withHome, DECK, homeFiles);
    expect(leaksLocalPaths(html), 'the author’s username shipped with the deck').toEqual([]);
  });

  it('keeps the theme-link id, which the runtime looks up', () => {
    const { html } = bundleDeck(HTML, DECK, deps());
    expect(html, 'runtime.js theme switching would throw on a bundled deck').toContain('id="theme-link"');
  });

  it('counts what it inlined', () => {
    expect(bundleDeck(HTML, DECK, deps()).inlined).toBe(4);
  });

  /*
   * A missing file must be REPORTED, not silently produce a deck that is broken
   * only for the recipient. Exporting anyway is deliberate: three good slides
   * beat a refusal.
   */
  it('reports what it could not read rather than failing silently', () => {
    const { missing, html } = bundleDeck(HTML, DECK, deps({ readText: () => null }));
    expect(missing).toContain('/plugins/assets/base.css');
    expect(missing).toContain('/plugins/assets/runtime.js');
    expect(html, 'the reference should be left intact when it cannot be inlined').toContain('<link rel="stylesheet"');
  });

  it('reports a missing image too', () => {
    const { missing } = bundleDeck(HTML, DECK, deps({ readBinary: () => null }));
    expect(missing).toContain('images/cover.png');
  });

  /*
   * The stated boundary: typography still comes from the network. Reported so
   * the caller can say so, rather than the user finding out on a plane.
   */
  it('reports the remote font imports it left alone', () => {
    const { remoteFonts } = bundleDeck(HTML, DECK, deps());
    expect(remoteFonts.some((u) => u.includes('fonts.googleapis.com'))).toBe(true);
  });

  it('does not try to inline a remote stylesheet or image', () => {
    const remote = '<link rel="stylesheet" href="https://cdn.example.com/a.css"><img src="https://x.com/a.png">';
    const { html, missing } = bundleDeck(remote, DECK, deps());
    expect(html).toContain('https://cdn.example.com/a.css');
    expect(html).toContain('https://x.com/a.png');
    expect(missing).toEqual([]);
  });

  it('leaves an existing data URI alone', () => {
    const inline = '<img src="data:image/png;base64,AAAA">';
    expect(bundleDeck(inline, DECK, deps()).html).toBe(inline);
  });

  /*
   * `</script>` inside the inlined JS ends the element early and dumps the rest
   * of the file into the page as visible text.
   */
  it('escapes a closing tag hidden inside the inlined script', () => {
    const evil: Record<string, string> = { ...files, '/plugins/assets/runtime.js': 'const s = "</script><h1>escaped</h1>";' };
    const { html } = bundleDeck(HTML, DECK, deps({ readText: (p) => evil[p] ?? null }));
    expect(html, 'the script broke out of its element').not.toContain('</script><h1>');
    expect(html).toContain('<\\/script>');
  });

  it('escapes a closing tag hidden inside the inlined css', () => {
    const evil: Record<string, string> = { ...files, '/plugins/assets/base.css': 'a{} </style><h1>escaped</h1>' };
    const { html } = bundleDeck(HTML, DECK, deps({ readText: (p) => evil[p] ?? null }));
    expect(html).not.toContain('</style><h1>');
  });

  it('strips a file:// prefix and a cache-busting query', () => {
    const noisy = '<link rel="stylesheet" href="file:///plugins/assets/base.css?v=2">';
    const { html, missing } = bundleDeck(noisy, DECK, deps());
    expect(missing).toEqual([]);
    expect(html).toContain('.slide { color: red }');
  });

  it('is idempotent — re-exporting an export changes nothing', () => {
    const once = bundleDeck(HTML, DECK, deps()).html;
    expect(bundleDeck(once, DECK, deps()).html).toBe(once);
  });

  it('survives a deck with nothing to inline', () => {
    const plain = '<html><body><p>hello</p></body></html>';
    const r = bundleDeck(plain, DECK, deps());
    expect(r.html).toBe(plain);
    expect(r.inlined).toBe(0);
  });
});

describe('leaksLocalPaths', () => {
  it.each([
    ['<link href="/Users/adam/x.css">', '/Users/adam/x.css'],
    ['<img src="file:///home/adam/y.png">', '/home/adam/y.png'],
    ['<script src="C:\\Users\\adam\\z.js"></script>', 'C:\\Users\\adam\\z.js'],
  ])('finds %s', (html, expected) => {
    expect(leaksLocalPaths(html)).toContain(expected);
  });

  it('is quiet for a clean export', () => {
    expect(leaksLocalPaths('<img src="data:image/png;base64,AA"><style>a{}</style>')).toEqual([]);
  });
});

describe('exportFileName', () => {
  it.each([
    ['/w/western-sydney-house-prices.html', 'western-sydney-house-prices.share.html'],
    ['/w/deck.htm', 'deck.share.html'],
    ['deck.html', 'deck.share.html'],
  ])('%s → %s', (input, expected) => {
    expect(exportFileName(input)).toBe(expected);
  });
});
