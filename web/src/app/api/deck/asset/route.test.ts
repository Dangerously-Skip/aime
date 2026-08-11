import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

/**
 * This route takes a filesystem path from the caller, so its whole job is to be
 * narrower than it looks. Two locks, both applied AFTER resolution rather than
 * by stripping characters: the target must land inside the deck's own
 * directory, and its extension must be on the image allowlist.
 */
const get = (deck: string, file: string) =>
  GET(
    new NextRequest(
      `http://localhost:3100/api/deck/asset?deck=${encodeURIComponent(deck)}&file=${encodeURIComponent(file)}`,
    ),
  );

const DECK = '/tmp/deck-asset-test/deck.html';

describe('serving a deck-adjacent image', () => {
  it('serves an image beside the deck', async () => {
    const res = await get(DECK, 'images/cover.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNG-ish');
  });

  it('does not cache, because a regenerated deck rewrites its images in place', async () => {
    const res = await get(DECK, 'images/cover.png');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('it cannot be turned into a file reader', () => {
  it.each([
    ['a parent-directory climb', '../secret.png'],
    ['a deeper climb', '../../etc/hosts.png'],
    ['an encoded climb', '..%2Fsecret.png'],
    ['an absolute path', '/tmp/secret.png'],
  ])('refuses %s', async (_label, file) => {
    const res = await get(DECK, file);
    expect(res.status, `${file} was served`).toBe(404);
  });

  it('refuses a non-image beside the deck', async () => {
    const res = await get(DECK, 'deck.html');
    expect(res.status).toBe(404);
  });

  it('refuses a directory', async () => {
    expect((await get(DECK, 'images')).status).toBe(404);
  });

  it('refuses a file that is not there', async () => {
    expect((await get(DECK, 'images/missing.png')).status).toBe(404);
  });

  it('requires both parameters', async () => {
    const res = await GET(new NextRequest('http://localhost:3100/api/deck/asset?deck=/tmp/x.html'));
    expect(res.status).toBe(400);
  });

  /*
   * The residual, stated: `deck` is caller-supplied, so this serves images from
   * whatever directory a deck path names. It is bounded to IMAGES in ONE
   * directory, which is strictly narrower than `/api/files/read` — the route the
   * viewer already uses to load the deck itself — so it widens nothing.
   */
  it('still refuses a non-image even when the deck path is arbitrary', async () => {
    const res = await get('/etc/hosts', 'hosts');
    expect(res.status).toBe(404);
  });
});
