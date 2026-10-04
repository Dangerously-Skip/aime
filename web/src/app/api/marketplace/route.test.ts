import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A failed load is an error, not an empty directory.
 *
 * REGRESSION: the upstream fetch failing returned `200 { plugins: [] }`, so
 * the client's error branch could never fire and the Marketplace told an
 * offline user "No plugins match your search." Only the UPSTREAM is stubbed;
 * the real handler runs. The module is re-imported per test because its cache
 * is module state.
 */

const upstream = vi.fn();

async function loadRoute() {
  vi.resetModules();
  return import('./route');
}

const req = (q = '') => new Request(`http://localhost/api/marketplace${q}`);

beforeEach(() => {
  upstream.mockReset();
  vi.stubGlobal('fetch', upstream);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/marketplace', () => {
  it('returns 502 with a reason when the directory cannot be reached', async () => {
    upstream.mockRejectedValue(new TypeError('fetch failed'));
    const { GET } = await loadRoute();

    const res = await GET(req());

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Couldn't reach the plugin directory/);
  });

  it('treats an upstream error status the same way', async () => {
    upstream.mockResolvedValue(new Response('rate limited', { status: 429 }));
    const { GET } = await loadRoute();
    expect((await GET(req())).status).toBe(502);
  });

  it('serves the stale copy when a refresh fails after a good load', async () => {
    vi.useFakeTimers();
    try {
      upstream.mockResolvedValueOnce(
        Response.json({ plugins: [{ name: 'a', description: 'A', source: './a', category: 'design' }] }),
      );
      const { GET } = await loadRoute();
      expect((await GET(req())).status).toBe(200);

      vi.advanceTimersByTime(16 * 60 * 1000); // past the TTL
      upstream.mockRejectedValueOnce(new TypeError('fetch failed'));

      const res = await GET(req());
      expect(res.status).toBe(200);
      expect((await res.json()).plugins.map((p: { name: string }) => p.name)).toEqual(['a']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty directory is still a 200', async () => {
    upstream.mockResolvedValue(Response.json({ plugins: [] }));
    const { GET } = await loadRoute();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plugins: [], categories: [] });
  });
});
