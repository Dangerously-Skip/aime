import { describe, it, expect, vi } from 'vitest';
import { inlineDeckAssets, linkedAssetUrls } from './deck-inline-assets';

/**
 * The deck must carry its runtime, not link to it — see the module doc for the
 * measurement. These cover the transformation; that it FIXES the deck was
 * verified against the real app over CDP, because the failure does not
 * reproduce in Chromium.
 */

const DECK = `<html><head>
<link rel="stylesheet" href="/api/themes/asset?file=base.css">
<link rel="stylesheet" href="/api/themes/asset?file=themes%2Fmagazine-bold.css">
<script src="/api/themes/asset?file=runtime.js"></script>
</head><body><div class="deck"><section class="slide">a</section></div></body></html>`;

const serve = (map: Record<string, string>) => (url: string) => {
  const file = decodeURIComponent(url.split('file=')[1] ?? '');
  const hit = map[file];
  return hit === undefined ? Promise.reject(new Error('404')) : Promise.resolve(hit);
};

describe('inlining a deck', () => {
  it('finds every distinct linked asset', () => {
    expect(linkedAssetUrls(DECK)).toHaveLength(3);
  });

  it('replaces stylesheets and scripts with their contents', async () => {
    const out = await inlineDeckAssets(
      DECK,
      serve({
        'base.css': '.slide{color:red}',
        'themes/magazine-bold.css': 'h1{font-weight:900}',
        'runtime.js': 'window.__ran = true;',
      }),
    );

    expect(out, 'a link survived — the frame would have to fetch it').not.toMatch(
      /(?:href|src)="\/api\/themes\/asset/,
    );
    expect(out).toContain('<style>.slide{color:red}</style>');
    expect(out).toContain('<script>window.__ran = true;</script>');
  });

  it('leaves an asset it could not fetch as a link', async () => {
    /*
     * Dropping the tag would be worse: a link may still work (it does in a
     * browser), and a deck missing a stylesheet is more use than one missing a
     * whole element.
     */
    const out = await inlineDeckAssets(DECK, serve({ 'runtime.js': 'x' }));
    expect(out).toContain('href="/api/themes/asset?file=base.css"');
    expect(out).toContain('<script>x</script>');
  });

  it('fetches each asset once even when it appears twice', async () => {
    const fetchText = vi.fn().mockResolvedValue('/* css */');
    const twice = `<link href="/api/themes/asset?file=base.css"><link href="/api/themes/asset?file=base.css">`;
    await inlineDeckAssets(twice, fetchText);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('decodes &amp; before fetching', async () => {
    // The URL came out of an HTML attribute, so `&` arrives escaped and the
    // route would see a parameter named `amp;file`.
    const fetchText = vi.fn().mockResolvedValue('x');
    await inlineDeckAssets('<script src="/api/themes/asset?file=a.js&amp;v=2"></script>', fetchText);
    expect(fetchText).toHaveBeenCalledWith('/api/themes/asset?file=a.js&v=2');
  });

  it('is a no-op on a page with no linked assets', async () => {
    const plain = '<html><body><p>hi</p></body></html>';
    expect(await inlineDeckAssets(plain, vi.fn())).toBe(plain);
  });
});
