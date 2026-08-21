import type { SearchResult } from './providers';
import type { SearchRoute } from './resolve';

/**
 * The one place the four backends stop looking alike.
 *
 * Everything above this file sees `query -> SearchResult[]`. Everything below is
 * four unrelated HTTP APIs, one of which is not a search API at all.
 */

/** Cap on snippet length. A full page here would swamp the model's context. */
const SNIPPET_CHARS = 300;

const clean = (r: Partial<SearchResult>): SearchResult | null =>
  r.title && r.url
    ? { title: String(r.title), url: String(r.url), snippet: String(r.snippet ?? '').slice(0, SNIPPET_CHARS) }
    : null;

export interface SearchOptions {
  maxResults?: number;
  /** Abort budget. A search that hangs blocks the agent turn behind it. */
  timeoutMs?: number;
}

export class SearchError extends Error {
  constructor(
    message: string,
    /** Machine-readable, so callers can distinguish config from transport. */
    readonly code: 'not_configured' | 'auth' | 'upstream' | 'timeout',
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

/**
 * Run a search through whichever provider resolved.
 *
 * Throws rather than returning `[]` on failure, because those two cases needed
 * distinguishing and previously did not: the old proxy returned `{results: []}`
 * for a DNS failure, which reads to a caller as "the web contains nothing about
 * your query" and to a model as a reason to fall back to guessing URLs.
 */
export async function runSearch(
  route: SearchRoute,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const maxResults = opts.maxResults ?? 10;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);

  try {
    switch (route.providerId) {
      case 'searxng':
        return await searxng(route, query, maxResults, signal);
      case 'brave':
        return await brave(route, query, maxResults, signal);
      case 'tavily':
        return await tavily(route, query, maxResults, signal);
      case 'openrouter':
        return await openrouter(route, query, maxResults, signal);
    }
  } catch (e) {
    if (e instanceof SearchError) throw e;
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new SearchError(`Search timed out after ${opts.timeoutMs ?? 20_000}ms`, 'timeout');
    }
    throw new SearchError(e instanceof Error ? e.message : String(e), 'upstream');
  }
}

/** Raise the right code for a non-2xx, so Settings can say "bad key" precisely. */
function assertOk(res: Response, provider: string): void {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new SearchError(`${provider} rejected the API key (${res.status})`, 'auth');
  }
  throw new SearchError(`${provider} returned ${res.status}`, 'upstream');
}

async function searxng(
  route: SearchRoute,
  q: string,
  n: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  if (!route.instanceUrl) throw new SearchError('No SearXNG instance URL', 'not_configured');
  const res = await fetch(new URL('/search', route.instanceUrl).toString(), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q, format: 'json', pageno: '1', language: 'all', safesearch: '0' }),
    signal,
  });
  assertOk(res, 'SearXNG');
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? [])
    .slice(0, n)
    .map((r) => clean({ title: r.title as string, url: r.url as string, snippet: (r.content ?? r.snippet) as string }))
    .filter((r): r is SearchResult => r !== null);
}

async function brave(
  route: SearchRoute,
  q: string,
  n: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(Math.min(n, 20)));
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': route.apiKey ?? '' },
    signal,
  });
  assertOk(res, 'Brave');
  const data = (await res.json()) as { web?: { results?: Array<Record<string, unknown>> } };
  return (data.web?.results ?? [])
    .slice(0, n)
    .map((r) => clean({ title: r.title as string, url: r.url as string, snippet: r.description as string }))
    .filter((r): r is SearchResult => r !== null);
}

async function tavily(
  route: SearchRoute,
  q: string,
  n: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${route.apiKey ?? ''}` },
    body: JSON.stringify({ query: q, max_results: n }),
    signal,
  });
  assertOk(res, 'Tavily');
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  return (data.results ?? [])
    .slice(0, n)
    .map((r) => clean({ title: r.title as string, url: r.url as string, snippet: r.content as string }))
    .filter((r): r is SearchResult => r !== null);
}

/**
 * OpenRouter, which is not a search API.
 *
 * It is a model router; retrieval happens during inference via the `web` plugin
 * (the `:online` suffix is shorthand for the same thing). So a "search" here is
 * a chat completion whose ANNOTATIONS are the payload — the assistant's prose is
 * a by-product we discard.
 *
 * That is why the prompt asks for nothing useful and `max_tokens` is tiny: we
 * are paying for the retrieval, not the writing. The citations arrive whether or
 * not the model says anything worth reading.
 */
/**
 * The carrier used when nothing configured one.
 *
 * A default, not a hardcoded choice: it is overridable per route, named in one
 * place, and only reached when the caller expressed no preference. Kept cheap on
 * purpose — the model's prose is thrown away and only its citations are kept.
 */
export const DEFAULT_SEARCH_CARRIER = 'openai/gpt-4o-mini';

async function openrouter(
  route: SearchRoute,
  q: string,
  n: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${route.apiKey ?? ''}` },
    body: JSON.stringify({
      /*
       * The carrier for the web plugin. The answer is discarded, so the cheapest
       * capable model is right — but the ID MUST NOT BE HARDCODED HERE.
       *
       * It was `openai/gpt-4o-mini`, written into this file, which never
       * consults the model chokepoint. That is the memory extractor's bug in a
       * second place: an account that cannot serve that exact id gets a 400 and
       * search returns nothing, on every query, invisibly — because a failed
       * search degrades to "no results", which is indistinguishable from a
       * genuine miss.
       *
       * The route decides; this is only the fallback for a route that expressed
       * no preference, and it is named once, here, so there is one place to
       * change when the cheap model of the day changes.
       */
      model: route.carrierModel || DEFAULT_SEARCH_CARRIER,
      plugins: [{ id: 'web', max_results: n }],
      max_tokens: 64,
      messages: [{ role: 'user', content: `Search the web for: ${q}` }],
    }),
    signal,
  });
  assertOk(res, 'OpenRouter');
  const data = (await res.json()) as {
    choices?: Array<{ message?: { annotations?: Array<Record<string, unknown>> } }>;
  };
  const annotations = data.choices?.[0]?.message?.annotations ?? [];
  return annotations
    .filter((a) => a.type === 'url_citation')
    .slice(0, n)
    .map((a) => {
      const c = a.url_citation as Record<string, unknown> | undefined;
      return clean({ title: c?.title as string, url: c?.url as string, snippet: c?.content as string });
    })
    .filter((r): r is SearchResult => r !== null);
}
