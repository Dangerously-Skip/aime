import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { POST, readableFrom } from './route';

/*
 * Fixtures are created HERE rather than assumed on disk. The first version of
 * this file pointed at paths I had made by hand in /tmp, so it passed on my
 * machine and nowhere else — and started failing the moment I tidied up.
 */
let root = '';
let DECK_PATH = '';
let OUTSIDE = '';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-export-'));
  const assets = path.join(root, 'home', '.claude', 'plugins', 'html-deck', 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(path.join(root, 'w', 'images'), { recursive: true });
  fs.writeFileSync(path.join(assets, 'base.css'), '.slide{color:red}');
  fs.writeFileSync(path.join(root, 'w', 'images', 'cover.png'), 'PNGBYTES');
  OUTSIDE = path.join(root, 'outside-secret.css');
  fs.writeFileSync(OUTSIDE, 'SECRET');
  DECK_PATH = path.join(root, 'w', 'deck.html');
  fs.writeFileSync(
    DECK_PATH,
    ['<html><head>',
     `<link rel="stylesheet" href="${path.join(assets, 'base.css')}">`,
     `<link rel="stylesheet" href="${OUTSIDE}">`,
     '</head><body><img src="images/cover.png"></body></html>'].join('\n'),
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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
    const res = await post({ path: DECK_PATH });
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
    const out = await (await post({ path: DECK_PATH })).json();
    expect(out.html, 'an out-of-tree file was inlined').not.toContain('SECRET');
    expect(out.missing).toContain(OUTSIDE);
  });

  it('refuses a cross-origin caller', async () => {
    expect((await post({ path: DECK_PATH }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it.each([
    [{}, 400],
    [{ path: '   ' }, 400],
  ])('rejects %j with %i', async (body, status) => {
    expect((await post(body)).status).toBe(status);
  });

  it('404s for a deck that is not there', async () => {
    expect((await post({ path: path.join(root, 'w', 'nope.html') })).status).toBe(404);
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
