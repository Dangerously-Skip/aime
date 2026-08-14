import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * This route WRITES a credential and performs a live IMAP login, in an app that
 * deliberately loads untrusted web pages in its browser surface.
 *
 * A `text/plain` POST is a CORS-simple request — no preflight, so CORS never
 * gets a say — and `req.json()` ignores the content type, so the body parses
 * anyway. Without an origin check a page the user is merely LOOKING at could
 * overwrite their stored Apple ID (silently disconnecting mail, calendar and
 * contacts) and use the endpoint as an unauthenticated login oracle against
 * imap.mail.me.com.
 */
const store = vi.hoisted(() => ({ set: vi.fn(async () => {}), delete: vi.fn(async () => {}) }));
vi.mock('@/lib/models/credentials', () => ({
  getCredentialStore: () => ({ ...store, get: async () => undefined, getField: async () => undefined }),
  CredentialStoreUnavailable: class extends Error {},
}));
const probe = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/icloud/mail', () => ({ verifyMailLogin: probe, searchMail: probe }));

import { POST, DELETE } from './route';

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost:3100/api/icloud/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', host: 'localhost:3100', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  store.set.mockClear();
  store.delete.mockClear();
  probe.mockClear();
});

describe('a page in the browser surface cannot store credentials', () => {
  it.each([
    ['a cross-site POST', { 'sec-fetch-site': 'cross-site' }],
    ['a POST from another origin', { origin: 'https://evil.example' }],
  ])('refuses %s', async (_label, headers) => {
    const res = await POST(req({ appleId: 'a@b.com', appPassword: 'abcd-efgh-ijkl-mnop' }, headers));
    expect(res.status).toBe(403);
    expect(store.set, 'a credential was written for a cross-origin caller').not.toHaveBeenCalled();
  });

  it('refuses to be used as an IMAP login oracle', async () => {
    await POST(req({ appleId: 'victim@icloud.com', appPassword: 'guess' }, { 'sec-fetch-site': 'cross-site' }));
    expect(probe, 'an unauthenticated caller triggered a login attempt').not.toHaveBeenCalled();
  });

  it('refuses a cross-site DELETE, which would disconnect the account', async () => {
    const res = await DELETE(
      new NextRequest('http://localhost:3100/api/icloud/connect', {
        method: 'DELETE',
        headers: { host: 'localhost:3100', 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(403);
    expect(store.delete).not.toHaveBeenCalled();
  });

  /* The complement: the app's own renderer must still be able to connect. */
  it('still serves the renderer', async () => {
    const res = await POST(
      req({ appleId: 'me@icloud.com', appPassword: 'abcd-efgh-ijkl-mnop' }, {
        'sec-fetch-site': 'same-origin',
        origin: 'http://localhost:3100',
      }),
    );
    expect(res.status).not.toBe(403);
  });
});
