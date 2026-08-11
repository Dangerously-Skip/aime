import { describe, it, expect, vi } from 'vitest';
import {
  fetchUrl,
  htmlToText,
  looksPaywalled,
  describeFailure,
  FETCH_TIMEOUT_MS,
} from './fetch-url';

/**
 * The behaviour this exists for, in the user's words: "having to wait 180 sec on
 * searches or lookups that will never complete is the wrong way to handle failed
 * attempts, we should be failing them and moving on."
 *
 * Exactly right, and it is why the built-in `WebFetch` had to be replaced rather
 * than tuned. It accepts no timeout and the SDK cannot cancel a single tool, so
 * the ONLY lever was `TOOL_DEADLINE_MS` killing the whole query — 180 seconds of
 * nothing, then the loss of everything the turn had already produced, over a
 * paywall that a HEAD request settles in under a second.
 *
 * A failed fetch is ordinary on the open web. Every test here asserts the same
 * shape: it comes back FAST, as a result the model can read and act on.
 */

const respond = (init: {
  status?: number;
  body?: string;
  type?: string;
}): typeof fetch =>
  vi.fn().mockResolvedValue({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: '',
    headers: { get: () => init.type ?? 'text/html; charset=utf-8' },
    text: async () => init.body ?? '',
  }) as unknown as typeof fetch;

const rejectWith = (name: string): typeof fetch =>
  vi.fn().mockRejectedValue(Object.assign(new Error(name), { name })) as unknown as typeof fetch;

const PAGE = '<html><head><title>Best pizza</title></head><body><p>Lucio Pizzeria, Haberfield.</p></body></html>';

describe('a page that works', () => {
  it('returns its text and title', async () => {
    const r = await fetchUrl('https://example.com/pizza', { fetchImpl: respond({ body: PAGE }) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.title).toBe('Best pizza');
    expect(r.text).toContain('Lucio Pizzeria');
  });

  it('truncates rather than flooding the turn with one page', async () => {
    const huge = `<html><body><p>${'x'.repeat(5000)}</p></body></html>`;
    const r = await fetchUrl('https://example.com', {
      fetchImpl: respond({ body: huge }),
      maxChars: 1000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.length).toBe(1000);
    expect(r.truncated).toBe(true);
  });
});

describe('a page that will never give us the content', () => {
  it.each([
    ['paywall', 402],
    ['paywall', 451],
    ['blocked', 403],
    ['blocked', 401],
    ['blocked', 429],
    ['not-found', 404],
  ] as const)('reports %s for HTTP %i instead of hanging', async (kind, status) => {
    const r = await fetchUrl('https://example.com', { fetchImpl: respond({ status }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe(kind);
  });

  /**
   * The case that actually bites: the paywall answers 200 with a teaser, so the
   * status code says everything is fine and the article is not there.
   */
  it('catches a 200 paywall from the body', async () => {
    const teaser =
      '<html><body><p>Subscribe to continue reading this article. Already a subscriber? Log in.</p></body></html>';
    const r = await fetchUrl('https://example.com', { fetchImpl: respond({ body: teaser }) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('paywall');
  });

  /** A real article that MENTIONS subscriptions is still an article. */
  it('does not call a long article a paywall for saying "subscribe"', () => {
    expect(looksPaywalled(`Subscribe to our newsletter. ${'Real content. '.repeat(400)}`)).toBe(false);
  });

  it('gives up on a slow page rather than stalling the turn', async () => {
    const r = await fetchUrl('https://example.com', { fetchImpl: rejectWith('TimeoutError') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('timeout');
  });

  it('bounds itself well under the query deadline', () => {
    // The point of the whole change: a fetch resolves in seconds, not in the
    // three minutes TOOL_DEADLINE_MS would otherwise take to kill the query.
    expect(FETCH_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it('refuses a PDF or image rather than returning bytes as text', async () => {
    const r = await fetchUrl('https://example.com/a.pdf', {
      fetchImpl: respond({ type: 'application/pdf' }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('unsupported-type');
  });
});

/**
 * The model chooses these URLs — from a search result, from a page it just read,
 * sometimes from nothing at all. That makes them a different trust class from an
 * MCP server the USER configured, for which loopback is a supported setup.
 */
describe('it cannot be pointed at the machine it runs on', () => {
  it.each([
    'http://127.0.0.1:19533/api/health',
    'http://localhost:3000/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/admin',
    'http://192.168.1.10/',
    'http://[::1]/',
    'file:///etc/passwd',
  ])('refuses %s', async (url) => {
    const impl = vi.fn() as unknown as typeof fetch;
    const r = await fetchUrl(url, { fetchImpl: impl });
    expect(r.ok, `${url} was fetched`).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('refused');
    expect(impl, 'a request was actually made').not.toHaveBeenCalled();
  });

  it('still allows ordinary public pages', async () => {
    const r = await fetchUrl('https://www.goodfood.com.au/x', { fetchImpl: respond({ body: PAGE }) });
    expect(r.ok).toBe(true);
  });
});

/**
 * What the model is told decides whether it recovers. When a failure and an
 * empty result look alike, it starts inventing URLs to route around what it
 * thinks is missing data — the same lesson `SearchWeb`'s error text records.
 */
describe('the message tells the agent what to do next', () => {
  it.each(['paywall', 'blocked', 'not-found', 'timeout'] as const)(
    'tells it to use a different source on %s',
    (kind) => {
      const msg = describeFailure('https://afr.com/x', kind, 'HTTP 403');
      expect(msg).toContain('https://afr.com/x');
      expect(msg.toLowerCase()).toMatch(/different source|search again|another source/);
    },
  );

  it('says explicitly not to retry the same URL where retrying is futile', () => {
    expect(describeFailure('https://x.com', 'paywall', '')).toMatch(/do NOT retry/i);
    expect(describeFailure('https://x.com', 'blocked', '')).toMatch(/do NOT retry/i);
  });
});

describe('html to text', () => {
  it('drops script and style bodies rather than reading them as content', () => {
    const { text } = htmlToText(
      '<html><body><script>var secret=1</script><style>.a{color:red}</style><p>Hello</p></body></html>',
    );
    expect(text).not.toContain('secret');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Hello');
  });

  it('keeps list and paragraph structure as line breaks', () => {
    const { text } = htmlToText('<ul><li>One</li><li>Two</li></ul>');
    expect(text).toMatch(/One\s*\n\s*Two/);
  });

  it('decodes the entities that would otherwise reach the model raw', () => {
    const { text } = htmlToText('<p>Fish &amp; chips &mdash; Sydney&#39;s best</p>');
    expect(text).toContain('Fish & chips — Sydney\'s best');
  });
});

/**
 * The swap has to be complete, and this is the half that nearly shipped broken.
 *
 * `WebFetch` is denied in favour of `mcp__aime__FetchUrl`. The URL-provenance
 * guard — the only thing stopping the model fetching a plausible URL it invented
 * rather than searching — keys on the TOOL NAME, and knew only about `WebFetch`.
 * Denying that tool without teaching the guard the new name would have left the
 * guard installed, passing every one of its own tests, and protecting nothing.
 *
 * The provider suite caught it. This states it directly, so the next tool rename
 * fails here rather than in a security review.
 */
describe('replacing WebFetch does not disable the guards that watched it', () => {
  it('the provenance guard covers the tool that replaced it', async () => {
    const { isUrlFetchTool } = await import('./security/url-provenance');
    expect(isUrlFetchTool('mcp__aime__FetchUrl'), 'FetchUrl is unguarded').toBe(true);
    // Still listed: denied is not the same as absent, and a config change could
    // put it back within reach.
    expect(isUrlFetchTool('WebFetch')).toBe(true);
  });

  it('the built-in is actually denied, not merely left out of an allow list', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, 'providers/claude-provider.ts'),
      'utf-8',
    );
    const denyBlock = /const denied = new Set<string>\(\[[\s\S]{0,1800}?\]\);/.exec(src)?.[0] ?? '';
    expect(denyBlock, 'no deny block found — has it been renamed?').not.toBe('');
    expect(
      denyBlock,
      "WebFetch is not in deniedTools — allowedTools is an auto-approve list and restricts nothing",
    ).toMatch(/'WebFetch'/);
  });
});

/**
 * The private-address check has to run on every HOP, not just on what the model
 * typed.
 *
 * With `redirect: 'follow'` it ran once, on a value the server stops controlling
 * after the first response. A page the agent legitimately read links to
 * `https://attacker.example/x`, that 302s to the EC2 metadata endpoint, undici
 * follows it, the content-type is `text/plain`, and the instance credentials
 * come back to the model as tool output. `url-guard.ts`'s header says
 * resolve-then-pin belongs in the fetch layer; this is the fetch layer.
 */
describe('redirects are validated hop by hop', () => {
  /** A fake server: a map of URL → response, so a chain can be scripted. */
  const server = (routes: Record<string, { status?: number; location?: string; body?: string }>) => {
    const seen: string[] = [];
    const impl = vi.fn(async (url: string) => {
      seen.push(url);
      const r = routes[url] ?? { status: 404 };
      return {
        ok: (r.status ?? 200) < 400,
        status: r.status ?? 200,
        statusText: '',
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location'
              ? (r.location ?? null)
              : 'text/html; charset=utf-8',
        },
        text: async () => r.body ?? '',
      };
    }) as unknown as typeof fetch;
    return { impl, seen };
  };

  /*
   * The load-bearing option, asserted directly.
   *
   * A fake cannot emulate undici following a 302 internally — it hands back the
   * 3xx either way — so every test below passes just as happily with
   * `redirect: 'follow'`, under which the real client would follow the hop
   * itself and none of this code would ever see it. The option IS the guard, so
   * it gets its own assertion rather than being implied by the others.
   */
  it('asks the client not to follow redirects itself', async () => {
    const { impl } = server({ 'https://example.com/x': { status: 200, body: '<p>Hello there, world.</p>' } });
    await fetchUrl('https://example.com/x', { fetchImpl: impl });

    const init = (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect(init.redirect, 'the client would follow hops past the guard').toBe('manual');
  });

  it('refuses a redirect into cloud metadata', async () => {
    const { impl, seen } = server({
      'https://attacker.example/x': {
        status: 302,
        location: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      },
    });
    const r = await fetchUrl('https://attacker.example/x', { fetchImpl: impl });

    expect(r.ok, 'the redirect was followed into metadata').toBe(false);
    expect(r.ok === false && r.kind).toBe('refused');
    expect(
      seen.some((u) => u.includes('169.254.169.254')),
      'the metadata endpoint was actually requested',
    ).toBe(false);
  });

  it('refuses a redirect to loopback dressed as IPv6', async () => {
    const { impl } = server({
      'https://attacker.example/x': { status: 302, location: 'http://[::ffff:127.0.0.1]:3100/api/health' },
    });
    const r = await fetchUrl('https://attacker.example/x', { fetchImpl: impl });
    expect(r.ok).toBe(false);
  });

  /*
   * The complement, and the reason this follows redirects at all rather than
   * refusing them: http→https, trailing slashes and CDN hops are how the web
   * works, and a guard that broke them would be turned off.
   */
  it('follows an ordinary redirect and returns the destination', async () => {
    const { impl, seen } = server({
      'http://example.com/article': { status: 301, location: 'https://example.com/article' },
      'https://example.com/article': { status: 200, body: '<p>The article body, which is long enough to be real content.</p>' },
    });
    const r = await fetchUrl('http://example.com/article', { fetchImpl: impl });

    expect(r.ok, r.ok === false ? r.message : '').toBe(true);
    expect(r.ok === true && r.text).toContain('article body');
    expect(seen).toEqual(['http://example.com/article', 'https://example.com/article']);
  });

  it('resolves a relative Location against the hop it came from', async () => {
    const { impl, seen } = server({
      'https://example.com/a/old': { status: 302, location: '../b/new' },
      'https://example.com/b/new': { status: 200, body: '<p>Moved here, with enough text to count.</p>' },
    });
    const r = await fetchUrl('https://example.com/a/old', { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(seen[1]).toBe('https://example.com/b/new');
  });

  it('gives up on a redirect loop instead of spinning', async () => {
    const { impl, seen } = server({
      'https://example.com/a': { status: 302, location: 'https://example.com/b' },
      'https://example.com/b': { status: 302, location: 'https://example.com/a' },
    });
    const r = await fetchUrl('https://example.com/a', { fetchImpl: impl });

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toMatch(/redirect/i);
    expect(seen.length, 'the loop was not bounded').toBeLessThanOrEqual(7);
  });

  /* A 3xx with no Location is not a redirect; it is the response. */
  it('treats a 3xx without a Location as the final response', async () => {
    const { impl } = server({ 'https://example.com/x': { status: 304 } });
    const r = await fetchUrl('https://example.com/x', { fetchImpl: impl });
    expect(r.ok === false && r.kind).not.toBe('refused');
  });
});
