import { describe, it, expect, vi } from 'vitest';
import { googleDriveTarget } from './google-drive';
import { PublishError, checkAudience, normaliseRecipients, type PublishTarget } from './types';

/**
 * Drive is the tier that can honour "share with these three people" — it has an
 * identity model, so the restriction is enforced at request time by Google
 * rather than by a URL being hard to guess. Everything here drives the real
 * request sequence through a fake `fetch`, because the interesting paths are
 * the FAILURES: a share that half-applied, an expired token, a bad address.
 */
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const bad = (status: number, message = 'nope') => ({
  ok: false,
  status,
  json: async () => ({ error: { message } }),
});

function server(handlers: { upload?: unknown; permission?: unknown; del?: unknown } = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.includes('/upload/')) return handlers.upload ?? ok({ id: 'FILE1', webViewLink: 'https://drive.google.com/file/d/FILE1/view' });
    if (url.includes('/permissions')) return handlers.permission ?? ok({ id: 'perm' });
    if (init.method === 'DELETE') return handlers.del ?? ok({});
    return ok({});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const deck = { fileName: 'deck.share.html', html: '<html>deck</html>' };

describe('publishing to Drive', () => {
  it('uploads and returns a link anyone can open', async () => {
    const { impl, calls } = server();
    const r = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).publish({
      ...deck,
      audience: { kind: 'link' },
    });

    expect(r.url).toContain('drive.google.com');
    expect(r.effective).toEqual({ kind: 'link' });
    expect(r.summary).toMatch(/anyone with this link/i);
    expect(JSON.parse(calls[1].body as string)).toEqual({ role: 'reader', type: 'anyone' });
  });

  it('sends the file name and the html', async () => {
    const { impl, calls } = server();
    await googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).publish({ ...deck, audience: { kind: 'link' } });
    expect(calls[0].body).toContain('deck.share.html');
    expect(calls[0].body).toContain('<html>deck</html>');
  });

  it('grants one permission per named person', async () => {
    const { impl, calls } = server();
    const r = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).publish({
      ...deck,
      audience: { kind: 'people', emails: ['a@x.com', 'b@y.com'] },
    });

    const grants = calls.filter((c) => c.url.includes('/permissions')).map((c) => JSON.parse(c.body as string));
    expect(grants).toEqual([
      { role: 'reader', type: 'user', emailAddress: 'a@x.com' },
      { role: 'reader', type: 'user', emailAddress: 'b@y.com' },
    ]);
    expect(r.effective).toEqual({ kind: 'people', emails: ['a@x.com', 'b@y.com'] });
    expect(r.summary, 'the user is not told recipients need to sign in').toMatch(/sign in/i);
  });

  it('never makes a people-share public as well', async () => {
    const { impl, calls } = server();
    await googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).publish({
      ...deck,
      audience: { kind: 'people', emails: ['a@x.com'] },
    });
    const grants = calls.filter((c) => c.url.includes('/permissions')).map((c) => JSON.parse(c.body as string));
    expect(grants.some((g) => g.type === 'anyone'), 'a restricted deck was also shared publicly').toBe(false);
  });

  /*
   * The dangerous partial failure: the file uploaded, the share did not. Saying
   * "published" would tell the user a colleague can open something they cannot.
   */
  it('reports an upload that succeeded with a share that failed', async () => {
    const { impl } = server({ permission: bad(403, 'insufficient permissions') });
    const err = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl })
      .publish({ ...deck, audience: { kind: 'people', emails: ['a@x.com'] } })
      .catch((e) => e);

    expect(err).toBeInstanceOf(PublishError);
    expect(err.message).toMatch(/uploaded but sharing/i);
    expect(err.message, 'the user is not told where the deck actually is').toMatch(/in your Drive and currently private/i);
    expect(err.message).toContain('a@x.com');
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [500, 'upstream'],
  ])('classifies an upload failure with %i as %s', async (status, code) => {
    const { impl } = server({ upload: bad(status) });
    const err = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl })
      .publish({ ...deck, audience: { kind: 'link' } })
      .catch((e) => e);
    expect(err.code).toBe(code);
  });

  it('surfaces the upstream message rather than a status code alone', async () => {
    const { impl } = server({ upload: bad(403, 'Drive storage quota exceeded') });
    const err = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl })
      .publish({ ...deck, audience: { kind: 'link' } })
      .catch((e) => e);
    expect(err.message).toContain('quota exceeded');
  });

  it('refuses when the connector is not linked', async () => {
    const err = await googleDriveTarget({ accessToken: '' })
      .publish({ ...deck, audience: { kind: 'link' } })
      .catch((e) => e);
    expect(err.code).toBe('not-connected');
  });

  it('turns a network failure into a result, not a raw throw', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const err = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl })
      .publish({ ...deck, audience: { kind: 'link' } })
      .catch((e) => e);
    expect(err.code).toBe('network');
  });

  it('rejects a bad recipient before uploading anything', async () => {
    const { impl, calls } = server();
    const err = await googleDriveTarget({ accessToken: 'T', fetchImpl: impl })
      .publish({ ...deck, audience: { kind: 'people', emails: ['not an address'] } })
      .catch((e) => e);
    expect(err.code).toBe('invalid-recipient');
    expect(calls, 'the file was uploaded before the recipients were checked').toHaveLength(0);
  });

  describe('revoke', () => {
    it('deletes the file', async () => {
      const { impl, calls } = server();
      await googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).revoke!('FILE1');
      expect(calls[0].method).toBe('DELETE');
      expect(calls[0].url).toContain('FILE1');
    });

    it('treats an already-deleted file as success', async () => {
      const { impl } = server({ del: bad(404) });
      await expect(googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).revoke!('GONE')).resolves.toBeUndefined();
    });

    it('reports a failure that is not "already gone"', async () => {
      const { impl } = server({ del: bad(403, 'no') });
      await expect(googleDriveTarget({ accessToken: 'T', fetchImpl: impl }).revoke!('X')).rejects.toThrow(/could not remove/i);
    });
  });
});

/**
 * The guarantee this whole module exists to keep: a target that cannot enforce
 * "these people only" must REFUSE, not quietly hand back an unguessable link.
 */
describe('checkAudience', () => {
  const bucket: PublishTarget = {
    id: 'bucket',
    label: 'S3 bucket',
    capabilities: { people: false, revoke: true },
    publish: async () => { throw new Error('unused'); },
  };

  it('refuses a people-share on a target with no identity model', () => {
    expect(() => checkAudience(bucket, { kind: 'people', emails: ['a@x.com'] })).toThrow(/cannot restrict/i);
  });

  it('says what to do instead', () => {
    try {
      checkAudience(bucket, { kind: 'people', emails: ['a@x.com'] });
    } catch (e) {
      expect((e as Error).message).toMatch(/Google Drive or OneDrive/);
    }
  });

  it('allows a link share anywhere', () => {
    expect(() => checkAudience(bucket, { kind: 'link' })).not.toThrow();
  });

  it('allows a people-share on a target that can enforce it', () => {
    const drive = googleDriveTarget({ accessToken: 'T' });
    expect(() => checkAudience(drive, { kind: 'people', emails: ['a@x.com'] })).not.toThrow();
  });
});

describe('normaliseRecipients', () => {
  it('splits, trims, lowercases and de-duplicates', () => {
    expect(normaliseRecipients([' A@x.com, b@y.com ', 'a@X.com'])).toEqual(['a@x.com', 'b@y.com']);
  });

  it.each([[[]], [['']], [['not an address']], [['a@x.com', 'bad']]])('refuses %j', (input) => {
    expect(normaliseRecipients(input as string[])).toBeNull();
  });
});
