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
    response = await doFetch(verdict.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Without a browser-shaped UA a large share of sites serve a challenge
        // page instead of content, which reads to the model as an empty article.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
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
    body = await response.text();
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
