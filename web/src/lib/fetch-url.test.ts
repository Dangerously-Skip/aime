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
