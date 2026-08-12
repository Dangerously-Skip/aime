import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, readableFrom } from './route';

/**
 * The export reads files named by model-authored HTML, so what it is willing to
 * read is the whole security question. Two locks: same-origin (the app ships a
 * browser surface), and containment — beside the deck, or the vendored deck
 * assets, and nothing else.
 */
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('http://localhost:3100/api/deck/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3100', ...headers },
      body: JSON.stringify(body),
    }),
  );

describe('exporting a deck', () => {
  it('inlines what sits beside the deck and the vendored assets', async () => {
    const res = await post({ path: '/tmp/export-test/deck.html' });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.html).toContain('.slide{color:red}');
    expect(out.html).toContain('data:image/png;base64,');
    expect(out.fileName).toBe('deck.share.html');
  });

  /*
   * The lock that matters: the deck's HTML is written by a model, and a
   * `<link href="/etc/…">` in it must not become a file read.
   */
  it('refuses to inline a file outside the deck folder', async () => {
    const out = await (await post({ path: '/tmp/export-test/deck.html' })).json();
    expect(out.html, 'an out-of-tree file was inlined').not.toContain('SECRET');
    expect(out.missing).toContain('/tmp/outside-secret.css');
  });

  it('refuses a cross-origin caller', async () => {
    expect((await post({ path: '/tmp/export-test/deck.html' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it.each([
    [{}, 400],
    [{ path: '   ' }, 400],
    [{ path: '/tmp/export-test/nope.html' }, 404],
  ])('rejects %j with %i', async (body, status) => {
    expect((await post(body)).status).toBe(status);
  });
});

describe('readableFrom', () => {
  it('allows a file beside the deck, at any depth', () => {
    expect(readableFrom('/w', '/w/images/a.png')).toBe(true);
    expect(readableFrom('/w', '/w/a/b/c.css')).toBe(true);
  });

  it('refuses the deck directory itself and anything above it', () => {
    expect(readableFrom('/w', '/w')).toBe(false);
    expect(readableFrom('/w', '/etc/passwd')).toBe(false);
    expect(readableFrom('/w', '/w/../secret.css')).toBe(false);
  });

  it('allows the vendored deck assets, which the generator links absolutely', () => {
    expect(readableFrom('/w', '/Users/me/.claude/plugins/html-deck/assets/base.css')).toBe(true);
    expect(readableFrom('/w', '/Users/me/.claude/plugins/html-deck/assets/themes/x.css')).toBe(true);
  });

  it('does not turn that into "anything under .claude"', () => {
    expect(readableFrom('/w', '/Users/me/.claude/.credentials.json')).toBe(false);
    expect(readableFrom('/w', '/Users/me/.claude/plugins/html-deck/secrets.txt')).toBe(false);
  });
});
