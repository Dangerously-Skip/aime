import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
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

/*
 * Fixtures are built by the test, in its own temp directory. The first version
 * pointed at files I had created by hand in /tmp — which passed until I tidied
 * up, then failed in the full suite for a reason that had nothing to do with
 * the code. A test that depends on state it did not create is not a test.
 */
let dir: string;
let DECK: string;

beforeAll(() => {
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'deck-asset-'));
  fs.mkdirSync(nodePath.join(dir, 'images'));
  fs.writeFileSync(nodePath.join(dir, 'images', 'cover.png'), 'PNG-ish');
  fs.writeFileSync(nodePath.join(dir, 'deck.html'), '<html>');
  // A sibling of the deck's DIRECTORY, so a `..` climb has something to find.
  fs.writeFileSync(nodePath.join(dir, '..', nodePath.basename(dir) + '-secret.png'), 'secret');
  DECK = nodePath.join(dir, 'deck.html');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(nodePath.join(nodePath.dirname(dir), nodePath.basename(dir) + '-secret.png'), { force: true });
});

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
    ['a parent-directory climb', () => `../${nodePath.basename(dir)}-secret.png`],
    ['a deeper climb', () => '../../etc/hosts.png'],
    ['an encoded climb', () => `..%2F${nodePath.basename(dir)}-secret.png`],
    ['an absolute path', () => nodePath.join(nodePath.dirname(dir), `${nodePath.basename(dir)}-secret.png`)],
  ])('refuses %s', async (_label, file) => {
    const res = await get(DECK, file());
    expect(res.status, `${file()} was served`).toBe(404);
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
