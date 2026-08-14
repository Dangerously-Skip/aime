import { describe, it, expect, vi } from 'vitest';
import { s3Target, S3_PRESETS, type S3Config } from './s3-storage';
import { PublishError } from './types';

/**
 * One implementation for R2, S3, B2, Wasabi and MinIO — they speak the same
 * API. The honest limit of this tier is that a bucket has no identity model, so
 * "only these people" is refused rather than downgraded to a long URL.
 */
const CONFIG: S3Config = {
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'decks',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  region: 'auto',
  publicBaseUrl: 'https://decks.example.com',
};

function server(status = 200) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    return { ok: status < 400, status, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const target = (over: Partial<S3Config> = {}, status = 200) => {
  const { impl, calls } = server(status);
  return {
    calls,
    t: s3Target({
      config: { ...CONFIG, ...over },
      fetchImpl: impl,
      signer: async () => ({ authorization: 'AWS4-HMAC-SHA256 signed' }),
      randomKey: () => 'deadbeef',
    }),
  };
};

const deck = { fileName: 'deck.share.html', html: '<html>deck</html>' };

describe('publishing to a bucket', () => {
  it('PUTs the deck under an unguessable key', async () => {
    const { t, calls } = target();
    await t.publish({ ...deck, audience: { kind: 'link' } });
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://acct.r2.cloudflarestorage.com/decks/deadbeef/deck.share.html');
    expect(calls[0].body).toBe('<html>deck</html>');
  });

  it('signs the request', async () => {
    const signer = vi.fn(async (_req: { method: string }) => ({ authorization: 'sig' }));
    const { impl } = server();
    await s3Target({ config: CONFIG, fetchImpl: impl, signer, randomKey: () => 'k' })
      .publish({ ...deck, audience: { kind: 'link' } });
    expect(signer).toHaveBeenCalledOnce();
    expect(signer.mock.calls[0][0].method).toBe('PUT');
  });

  /*
   * The API endpoint is not the READ endpoint on R2, so a link built from it
   * 403s for everyone — including the person who just published.
   */
  it('returns the public URL, not the API endpoint', async () => {
    const { t } = target();
    const r = await t.publish({ ...deck, audience: { kind: 'link' } });
    expect(r.url).toBe('https://decks.example.com/deadbeef/deck.share.html');
  });

  it('says so when no public URL is configured, rather than handing over a dead link', async () => {
    const { t } = target({ publicBaseUrl: undefined });
    const r = await t.publish({ ...deck, audience: { kind: 'link' } });
    expect(r.summary).toMatch(/no public base url/i);
    expect(r.summary).toMatch(/set one in settings/i);
  });

  it('describes the link as unguessable but not restricted', async () => {
    const { t } = target();
    const r = await t.publish({ ...deck, audience: { kind: 'link' } });
    expect(r.summary).toMatch(/unguessable, but not restricted/i);
  });

  /* The whole point of the capability flag. */
  it('refuses to pretend it can restrict to named people', async () => {
    const { t, calls } = target();
    const err = await t.publish({ ...deck, audience: { kind: 'people', emails: ['a@x.com'] } }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.code).toBe('unsupported-audience');
    expect(err.message).toMatch(/Google Drive or OneDrive/);
    expect(calls, 'it uploaded before refusing').toHaveLength(0);
  });

  it.each([
    ['endpoint', { endpoint: '' }],
    ['bucket', { bucket: '' }],
    ['access key', { accessKeyId: '' }],
    ['secret key', { secretAccessKey: '' }],
  ])('refuses when the %s is missing', async (name, over) => {
    const { t } = target(over);
    const err = await t.publish({ ...deck, audience: { kind: 'link' } }).catch((e) => e);
    expect(err.code).toBe('not-connected');
    expect(err.message).toContain(name);
  });

  /*
   * The endpoint is user-supplied and fetched server-side, so it gets the same
   * guard as the search instance URL: a LAN MinIO is legitimate, link-local is
   * cloud metadata and never a bucket.
   */
  it.each([
    'http://169.254.169.254',
    'http://[::ffff:169.254.169.254]',
    'file:///etc/passwd',
    'not a url',
  ])('refuses the endpoint %s', async (endpoint) => {
    const { t, calls } = target({ endpoint });
    const err = await t.publish({ ...deck, audience: { kind: 'link' } }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(calls).toHaveLength(0);
  });

  it('allows a self-hosted MinIO on the LAN', async () => {
    const { t } = target({ endpoint: 'http://192.168.1.10:9000', publicBaseUrl: 'http://192.168.1.10:9000/decks' });
    await expect(t.publish({ ...deck, audience: { kind: 'link' } })).resolves.toBeDefined();
  });

  it.each([
    [403, 'auth'],
    [401, 'auth'],
    [500, 'upstream'],
  ])('classifies HTTP %i as %s', async (status, code) => {
    const { t } = target({}, status);
    const err = await t.publish({ ...deck, audience: { kind: 'link' } }).catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message, 'the message does not say what to check').toMatch(/bucket name, region/i);
  });

  it('turns a network failure into a result', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const t = s3Target({ config: CONFIG, fetchImpl: impl, signer: async () => ({}), randomKey: () => 'k' });
    const err = await t.publish({ ...deck, audience: { kind: 'link' } }).catch((e) => e);
    expect(err.code).toBe('network');
  });

  describe('revoke', () => {
    it('deletes the object', async () => {
      const { t, calls } = target();
      await t.revoke!('deadbeef/deck.share.html');
      expect(calls[0].method).toBe('DELETE');
      expect(calls[0].url).toContain('deadbeef');
    });

    it('treats an already-deleted object as success', async () => {
      const { t } = target({}, 404);
      await expect(t.revoke!('gone')).resolves.toBeUndefined();
    });
  });
});

/**
 * The key IS the access control here, so it has to be unguessable rather than
 * merely unique. A slug plus a timestamp is neither.
 */
describe('the object key', () => {
  it('is 160 bits of randomness by default', async () => {
    const { impl, calls } = server();
    await s3Target({ config: CONFIG, fetchImpl: impl, signer: async () => ({}) })
      .publish({ ...deck, audience: { kind: 'link' } });
    const key = new URL(calls[0].url).pathname.split('/')[2];
    expect(key).toMatch(/^[0-9a-f]{40}$/);
  });

  it('differs every time', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { impl, calls } = server();
      await s3Target({ config: CONFIG, fetchImpl: impl, signer: async () => ({}) })
        .publish({ ...deck, audience: { kind: 'link' } });
      seen.add(new URL(calls[0].url).pathname.split('/')[2]);
    }
    expect(seen.size).toBe(5);
  });
});

describe('S3_PRESETS', () => {
  it('covers the providers the one implementation actually serves', () => {
    expect(S3_PRESETS.map((p) => p.id)).toEqual(['r2', 's3', 'b2', 'minio']);
  });

  it('gives every preset an endpoint hint, since the shape differs per host', () => {
    for (const p of S3_PRESETS) {
      expect(p.endpointHint, `${p.id} has no hint`).toMatch(/^https?:\/\//);
      expect(p.note.length).toBeGreaterThan(20);
    }
  });
});

/**
 * A filename with `#` or `?` used to be signed and uploaded to a TRUNCATED key
 * while the reported id and share URL carried the full name — so the link 404'd
 * and revoke could not find the object.
 */
describe('object keys survive awkward filenames', () => {
  const upload = async (fileName: string) => {
    const { t, calls } = target();
    const r = await t.publish({ fileName, html: '<html>x</html>', audience: { kind: 'link' } });
    return { put: calls[0].url, result: r };
  };

  it('does not let a # start a fragment', async () => {
    const { put, result } = await upload('Q3 review #2.share.html');
    expect(put, 'the # truncated the uploaded key').toContain('%232');
    expect(put.endsWith('.share.html'), `uploaded to ${put}`).toBe(true);
    expect(result.url).toContain('%232');
  });

  it('does not let a ? start a query', async () => {
    const { put } = await upload('what now?.share.html');
    expect(put).toContain('%3F');
  });

  it('encodes spaces the same way in the upload and the share link', async () => {
    const { put, result } = await upload('my deck.share.html');
    const uploadedKey = put.split('/decks/')[1];
    const sharedKey = result.url.split('decks.example.com/')[1];
    expect(sharedKey, 'the share URL and the uploaded key disagree').toBe(uploadedKey);
  });

  it('keeps the id addressable, so revoke can find it', async () => {
    const { t, calls } = target();
    const r = await t.publish({ fileName: 'Q3 #2.share.html', html: 'x', audience: { kind: 'link' } });
    await t.revoke!(r.id);
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url, 'revoke addressed a different object than the upload').toBe(calls[0].url);
  });

  it('leaves an ordinary name alone', async () => {
    const { put } = await upload('deck.share.html');
    expect(put).toBe('https://acct.r2.cloudflarestorage.com/decks/deadbeef/deck.share.html');
  });
});
