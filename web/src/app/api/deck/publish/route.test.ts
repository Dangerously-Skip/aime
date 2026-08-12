import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';

/**
 * Publishing is a user action, not an agent tool: a deck is built from the
 * user's mail, calendar and files, and a URL cannot be un-sent. The route is
 * same-origin only and validates the audience before anything is uploaded.
 */
const secrets = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('@/lib/mcp/secret-store', () => ({
  getMcpSecretStore: () => ({ mode: 'encrypted', get: async () => secrets.value }),
}));

/* The bucket's secret is read from the encrypted store, never from the body. */
const bucketSecret = vi.hoisted(() => ({ value: 'SK' as string | undefined }));
vi.mock('@/lib/models/credentials', () => ({
  getCredentialStore: () => ({ getField: async () => bucketSecret.value }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import { POST, storageConfig } from './route';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('http://localhost:3100/api/deck/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3100', ...headers },
      body: JSON.stringify(body),
    }),
  );

/* Fixtures created here, not assumed on disk — see the note in the export
 * route's test: the first version of that one passed only on my machine. */
let root = '';
let DECK_PATH = '';
let DECK: { path: string; target: string };

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-publish-'));
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'images', 'c.png'), 'PNG');
  DECK_PATH = path.join(root, 'deck.html');
  fs.writeFileSync(DECK_PATH, '<html><body><img src="images/c.png"></body></html>');
  DECK = { path: DECK_PATH, target: 'google-drive' };
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  fetchMock.mockReset();
  secrets.value = { env: { GOOGLE_ACCESS_TOKEN: 'ya29.tok' } };
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('/upload/')
        ? { id: 'F1', webViewLink: 'https://drive.google.com/file/d/F1/view' }
        : {},
  }));
});

describe('publishing a deck', () => {
  it('bundles, uploads and returns a link', async () => {
    const res = await post({ ...DECK, audience: { kind: 'link' } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.url).toContain('drive.google.com');
    expect(out.effective).toEqual({ kind: 'link' });
  });

  it('uploads the BUNDLED deck, not the raw file', async () => {
    await post({ ...DECK, audience: { kind: 'link' } });
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body, 'a published deck must not depend on the author’s filesystem').toContain('data:image/png;base64,');
    expect(body).not.toContain('src="images/c.png"');
  });

  it('restricts to named people when asked', async () => {
    await post({ ...DECK, audience: { kind: 'people', emails: ['a@x.com'] } });
    const grants = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes('/permissions'))
      .map((c) => JSON.parse(String(c[1].body)));
    expect(grants).toEqual([{ role: 'reader', type: 'user', emailAddress: 'a@x.com' }]);
  });

  it('says the account is not connected rather than failing obscurely', async () => {
    secrets.value = undefined;
    const res = await post({ ...DECK, audience: { kind: 'link' } });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/not connected/i);
  });

  it('refuses a cross-origin caller', async () => {
    const res = await post({ ...DECK, audience: { kind: 'link' } }, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no path', async () => {
    expect((await post({ target: 'google-drive', audience: { kind: 'link' } })).status).toBe(400);
  });

  it('rejects a request with no audience', async () => {
    expect((await post({ ...DECK })).status).toBe(400);
  });

  it('rejects an unknown target', async () => {
    expect((await post({ ...DECK, target: 'dropbox', audience: { kind: 'link' } })).status).toBe(400);
  });

  it('404s for a deck that is not there', async () => {
    expect((await post({ ...DECK, path: path.join(root, 'nope.html'), audience: { kind: 'link' } })).status).toBe(404);
  });

  it('rejects a bad recipient without uploading', async () => {
    const res = await post({ ...DECK, audience: { kind: 'people', emails: ['nope'] } });
    expect(res.status).toBe(400);
    expect(fetchMock, 'the deck was uploaded before the recipients were checked').not.toHaveBeenCalled();
  });

  it('reports an expired token as auth, not as a generic failure', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid Credentials' } }) }));
    const res = await post({ ...DECK, audience: { kind: 'link' } });
    expect(res.status).toBe(401);
    expect((await res.json()).message).toContain('Invalid Credentials');
  });
});

/**
 * The bucket tier. Its credentials arrive in the REQUEST because the renderer
 * holds settings — the same shape as the search instance URL, and the same
 * reason its endpoint is validated server-side.
 */
describe('publishing to a bucket', () => {
  // No secretAccessKey here — that is the point: the renderer holds only
  // identifiers, and the secret is read server-side.
  const STORAGE = {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'decks',
    accessKeyId: 'AK',
    region: 'auto',
    publicBaseUrl: 'https://decks.example.com',
  };

  beforeEach(() => { bucketSecret.value = 'SK'; });

  it('refuses when no secret key has been saved', async () => {
    bucketSecret.value = undefined;
    const res = await post({ ...DECK, target: 's3', storage: STORAGE, audience: { kind: 'link' } });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/Settings → Sharing/);
  });

  it('does not let a caller supply the secret key', async () => {
    bucketSecret.value = undefined;
    const res = await post({
      ...DECK,
      target: 's3',
      storage: { ...STORAGE, secretAccessKey: 'ATTACKER' },
      audience: { kind: 'link' },
    });
    expect(res.status, 'a caller-supplied secret was honoured').toBe(409);
  });

  it('uploads and returns the public link', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const res = await post({ ...DECK, target: 's3', storage: STORAGE, audience: { kind: 'link' } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.url).toContain('decks.example.com');
  });

  /* The guarantee, end to end through the route rather than only in the unit. */
  it('refuses a people-share on a bucket', async () => {
    const res = await post({
      ...DECK,
      target: 's3',
      storage: STORAGE,
      audience: { kind: 'people', emails: ['a@x.com'] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/cannot restrict/i);
  });

  it('refuses a link-local endpoint', async () => {
    const res = await post({
      ...DECK,
      target: 's3',
      storage: { ...STORAGE, endpoint: 'http://169.254.169.254' },
      audience: { kind: 'link' },
    });
    expect(res.status).toBe(502);
  });

  it('does not need a Google connector', async () => {
    secrets.value = undefined;
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const res = await post({ ...DECK, target: 's3', storage: STORAGE, audience: { kind: 'link' } });
    expect(res.status, 'the bucket tier asked for a Google token').toBe(200);
  });
});

/**
 * A caller cannot supply the signing key. Tested directly because it is
 * otherwise unobservable: with the secret merged in either order the only
 * difference is which key signs a request nobody can inspect, so a sabotage of
 * the merge order failed nothing until this existed.
 */
describe('storageConfig', () => {
  it('uses the stored secret', () => {
    expect(storageConfig({ bucket: 'b' }, 'STORED').secretAccessKey).toBe('STORED');
  });

  it('ignores a secret supplied by the caller', () => {
    const cfg = storageConfig({ bucket: 'b', secretAccessKey: 'ATTACKER' } as never, 'STORED');
    expect(cfg.secretAccessKey, 'a caller-supplied signing key was honoured').toBe('STORED');
  });

  it('keeps the caller’s identifiers', () => {
    const cfg = storageConfig({ bucket: 'b', endpoint: 'https://e', region: 'auto', accessKeyId: 'AK' }, 'S');
    expect(cfg).toMatchObject({ bucket: 'b', endpoint: 'https://e', region: 'auto', accessKeyId: 'AK' });
  });
});
