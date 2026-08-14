import { validateFetchUrl } from '@/lib/mcp/url-guard';

/**
 * Fetch a web page with a deadline, and say what happened when there isn't one.
 *
 * This exists because the SDK's built-in `WebFetch` cannot be bounded. It has no
 * timeout option — the SDK's only cancellation levers are `interrupt()`,
 * `close()` and `stopTask()`, none of which cancels a single tool — so one
 * unresponsive page stalls the turn until the server's `TOOL_DEADLINE_MS` kills
 * the whole query. Observed: a paywalled article left `WebFetch` running past
 * 63s while four other fetches in the same turn returned in about 1.5s each.
 *
 * A page behind a paywall or a bot check is not an exceptional case on the open
 * web; it is Tuesday. The agent has to be able to give up on one source and try
 * the next, which means the failure must come back as a TOOL RESULT it can read,
 * not as the turn dying. That is the whole design goal here.
 */

/** Long enough for a slow-but-real page, short enough to try another source. */
export const FETCH_TIMEOUT_MS = 25_000;

/** Beyond this we are feeding the model boilerplate, not content. */
export const MAX_TEXT_CHARS = 40_000;

export type FetchFailure =
  | 'blocked'
  | 'paywall'
  | 'not-found'
  | 'timeout'
  | 'network'
  | 'refused'
  | 'unsupported-type';

export type FetchResult =
  | { ok: true; url: string; title: string | null; text: string; truncated: boolean }
  | { ok: false; kind: FetchFailure; message: string };

/**
 * Status codes that mean "this page exists but you may not have it".
 *
 * 402 and 451 are literal; 401/403 are what most paywalls and bot checks
 * actually return. They are separated from 5xx because the right response
 * differs: a different SOURCE helps here, a retry does not.
 */
function classifyStatus(status: number): FetchFailure | null {
  if (status === 402 || status === 451) return 'paywall';
  if (status === 401 || status === 403 || status === 429) return 'blocked';
  if (status === 404 || status === 410) return 'not-found';
  if (status >= 400) return 'network';
  return null;
}

/**
 * HTML to something worth reading.
 *
 * Deliberately crude — no parser dependency for what is a lossy step anyway.
 * The order matters: script/style/nav content must go before tags are stripped,
 * or their bodies survive as text.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 300) : null;

  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Block-level tags become line breaks so lists and paragraphs survive as
      // structure; without this the whole page arrives as one run-on line.
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)\s*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return { title, text };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:nbsp|#160);/gi, ' ')
    .replace(/&(?:amp|#38);/gi, '&')
    .replace(/&(?:lt|#60);/gi, '<')
    .replace(/&(?:gt|#62);/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:#39|apos|rsquo|#8217);/gi, "'")
    .replace(/&(?:mdash|#8212);/gi, '—')
    .replace(/&(?:ndash|#8211);/gi, '–');
}

/**
 * A paywall that returns HTTP 200.
 *
 * The common case, and the one that matters: the server answers normally with a
 * teaser and a subscribe prompt, so status alone cannot tell you the article is
 * not there. Requiring BOTH a paywall phrase and an implausibly short body keeps
 * this off articles that merely mention subscriptions — a news page about a
 * newspaper's paywall is still a page.
 */
export function looksPaywalled(text: string): boolean {
  if (text.length > 2_500) return false;
  return /subscribe (?:to|now|for)|subscriber[- ]only|create an account to (?:read|continue)|register to continue|this (?:article|content) is for subscribers|already a subscriber/i.test(
    text,
  );
}

/**
 * The first `maxChars` characters of a response, without buffering the rest.
 *
 * Cancels the body once the cap is reached: the remote may be streaming
 * something enormous, and there is no reason to receive it.
 */
async function readCapped(response: Response, maxChars: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, maxChars);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= maxChars) {
        out = out.slice(0, maxChars);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

export async function fetchUrl(
  raw: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; maxChars?: number } = {},
): Promise<FetchResult> {
  const verdict = validateFetchUrl(raw);
  if (!verdict.ok) return { ok: false, kind: 'refused', message: verdict.message };

  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxChars = opts.maxChars ?? MAX_TEXT_CHARS;
  const doFetch = opts.fetchImpl ?? fetch;

  let response: Response;
  try {
    /**
     * Every hop is validated, not just the first.
     *
     * `redirect: 'follow'` made the private-address check a one-time check on a
     * value the server stops controlling after the first response. A public page
     * the agent legitimately read links to `https://attacker.example/x`, which
     * 302s to `http://169.254.169.254/latest/meta-data/iam/security-credentials/`;
     * undici follows it, the content-type is `text/plain`, and the instance
     * credentials come back as tool output. `url-guard.ts`'s own header says
     * resolve-then-pin "belongs in the fetch layer" — this is the fetch layer,
     * and it was not doing it.
     *
     * `manual` rather than a redirect count of 0 because we still want to follow
     * ordinary redirects: http→https, trailing slashes and CDN hops are how the
     * web works, and refusing them would break most real fetches. What changes is
     * that each destination goes back through `validateFetchUrl` first.
     */
    const MAX_HOPS = 5;
    /*
     * ONE deadline for the whole fetch, not one per hop.
     *
     * Each hop was given a fresh `AbortSignal.timeout`, so five hops stalling
     * 24s each cost 120s against a module that advertises 25 — and ate most of
     * the 180s tool deadline on the way. `AbortSignal.any` lets each request
     * still carry its own signal while the overall budget keeps ticking.
     */
    const overall = AbortSignal.timeout(timeoutMs);
    let target = verdict.url;
    let hops = 0;
    for (;;) {
      response = await doFetch(target, {
        redirect: 'manual',
        signal: AbortSignal.any([overall, AbortSignal.timeout(timeoutMs)]),
        headers: {
          // Without a browser-shaped UA a large share of sites serve a challenge
          // page instead of content, which reads to the model as an empty article.
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
      });

      const location = response.status >= 300 && response.status < 400
        ? response.headers.get('location')
        : null;
      if (!location) break;

      if (++hops > MAX_HOPS) {
        return { ok: false, kind: 'network', message: `Too many redirects (more than ${MAX_HOPS}).` };
      }
      // Relative Locations are both legal and common, so resolve against the hop
      // we are on rather than the URL we started from.
      let next: string;
      try {
        next = new URL(location, target).toString();
      } catch {
        return { ok: false, kind: 'network', message: 'Redirected to a URL that could not be parsed.' };
      }
      const hop = validateFetchUrl(next);
      if (!hop.ok) {
        return {
          ok: false,
          kind: 'refused',
          message: `Redirected to an address that cannot be fetched. ${hop.message}`,
        };
      }
      target = hop.url;
    }
  } catch (e) {
    // `AbortSignal.timeout` rejects with TimeoutError; anything else is the
    // network. The distinction is worth keeping because only one of them is
    // worth retrying.
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        kind: 'timeout',
        message: `No response within ${Math.round(timeoutMs / 1000)}s.`,
      };
    }
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : 'Request failed' };
  }

  const failed = classifyStatus(response.status);
  if (failed) {
    return { ok: false, kind: failed, message: `HTTP ${response.status} ${response.statusText}`.trim() };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/html|text\/plain|application\/(xhtml|json|xml)/i.test(contentType)) {
    return {
      ok: false,
      kind: 'unsupported-type',
      message: `Not a readable page (content-type: ${contentType || 'unknown'}).`,
    };
  }

  let body: string;
  try {
    /*
     * Read with a CAP, rather than buffering everything and truncating after.
     *
     * `response.text()` allocated the whole body first, so a 3GB `text/plain`
     * response — reachable the moment a search result points at one — was an
     * OOM in the Next server process before `MAX_TEXT_CHARS` ever applied.
     * Reading incrementally means the cap is a real limit on memory, not just
     * on what the model sees.
     */
    /*
     * The raw cap is a MEMORY bound and deliberately looser than `maxChars`,
     * which bounds the extracted TEXT. Capping the raw body at `maxChars` made
     * a 1000-char budget yield 985 characters of text, because the tags are
     * stripped afterwards — the limit has to leave room for the markup it is
     * about to discard. Eight-to-one is far above any real HTML ratio while
     * still turning an unbounded read into a bounded one.
     */
    body = await readCapped(response, maxChars * 8);
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, kind: 'timeout', message: `Body did not arrive within ${Math.round(timeoutMs / 1000)}s.` };
    }
    return { ok: false, kind: 'network', message: 'Could not read the response body.' };
  }

  const { title, text } = /html|xml/i.test(contentType)
    ? htmlToText(body)
    : { title: null, text: body };

  if (looksPaywalled(text)) {
    return { ok: false, kind: 'paywall', message: 'The page returned a subscribe prompt rather than the article.' };
  }

  return {
    ok: true,
    url: verdict.url,
    title,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}

/**
 * What the model is told, which is the part that decides whether it recovers.
 *
 * Every failure says explicitly to try a DIFFERENT source rather than the same
 * URL again. The `SearchWeb` tool learned the same lesson: when a failure and an
 * empty result look alike, the model starts inventing URLs to work around what
 * it thinks is missing data.
 */
export function describeFailure(url: string, kind: FetchFailure, message: string): string {
  const advice: Record<FetchFailure, string> = {
    paywall: 'It is behind a paywall. Do NOT retry it — find the same information on a different source that is not paywalled.',
    blocked: 'The site refused automated access. Do NOT retry it — use a different source.',
    'not-found': 'That page does not exist. Do not guess a corrected URL — search again.',
    timeout: 'It did not respond in time. Move on to another source rather than retrying.',
    network: 'The request failed. Try a different source.',
    refused: 'That address is not a public web page and was not fetched.',
    'unsupported-type': 'It is not a readable page (a PDF, image or download). Use a different source.',
  };
  return `Could not read ${url} — ${message}. ${advice[kind]}`;
}
