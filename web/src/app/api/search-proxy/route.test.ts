import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * This route takes a fetch TARGET from the request body.
 *
 * `settings.searchInstanceUrl` reaches `runSearch`, which fetches it
 * server-side. The route this replaced read that host from `process.env` only,
 * so the diff that introduced settings-from-the-body also introduced a
 * caller-controlled SSRF — in an app that ships a browser surface, where "the
 * caller" can be any page the user is looking at.
 */
const runSearchMock = vi.hoisted(() => vi.fn(async () => [{ title: 't', url: 'https://x.com', snippet: 's' }]));
vi.mock('@/lib/search/execute', () => ({
  runSearch: runSearchMock,
  SearchError: class extends Error {
    code: string;
    constructor(m: string, code: string) { super(m); this.code = code; }
  },
}));
vi.mock('@/lib/search/server-credentials', () => ({
  withStoredCredential: async (r: unknown) => r,
}));

import { POST } from './route';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('http://localhost:3100/api/search-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3100', ...headers },
      body: JSON.stringify(body),
    }),
  );

const SEARXNG = (url: string) => ({
  query: 'anything',
  settings: { searchProvider: 'searxng', searchInstanceUrl: url },
});

beforeEach(() => runSearchMock.mockClear());

describe('a page in the browser surface cannot drive this route', () => {
  it('refuses a cross-site POST', async () => {
    const res = await post(SEARXNG('http://127.0.0.1:3100'), { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(runSearchMock, 'a cross-origin caller reached the fetch').not.toHaveBeenCalled();
  });

  it('refuses a POST whose Origin is another host', async () => {
    const res = await post(SEARXNG('http://10.0.0.5:8080'), { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(runSearchMock).not.toHaveBeenCalled();
  });

  it('still serves the renderer', async () => {
    const res = await post(SEARXNG('http://192.168.1.10:8080'), {
      'sec-fetch-site': 'same-origin',
      origin: 'http://localhost:3100',
    });
    expect(res.status).toBe(200);
    expect(runSearchMock).toHaveBeenCalled();
  });
});

describe('the instance URL is validated before it is fetched', () => {
  it('refuses cloud metadata', async () => {
    const res = await post(SEARXNG('http://169.254.169.254'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'bad_instance_url' });
    expect(runSearchMock, 'the metadata endpoint was fetched').not.toHaveBeenCalled();
  });

  it('refuses metadata reached through an IPv6 literal', async () => {
    const res = await post(SEARXNG('http://[::ffff:169.254.169.254]'));
    expect(res.status).toBe(400);
    expect(runSearchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['file:///etc/passwd', 'a non-http scheme'],
    ['http://user:pw@example.com', 'embedded credentials'],
    ['not a url', 'unparseable'],
  ])('refuses %s (%s)', async (url) => {
    expect((await post(SEARXNG(url))).status).toBe(400);
    expect(runSearchMock).not.toHaveBeenCalled();
  });

  /*
   * The complement, and the reason this is not `validateFetchUrl`: a self-hosted
   * SearXNG on a LAN address is an ordinary setup that the USER configured, not
   * a URL the model picked out of a search result. Refusing it would break a
   * real installation to close nothing — the same caller could fetch that
   * address itself.
   */
  it.each([
    'http://192.168.1.10:8080',
    'http://10.0.0.5:8080',
    'http://localhost:8080',
    'https://searx.example.org',
  ])('allows the self-hosted instance %s', async (url) => {
    expect((await post(SEARXNG(url))).status).toBe(200);
  });
});
