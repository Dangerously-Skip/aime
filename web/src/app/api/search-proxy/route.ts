import { NextRequest, NextResponse } from 'next/server';
import { resolveSearchRoute, type SearchSettings } from '@/lib/search/resolve';
import { runSearch, SearchError } from '@/lib/search/execute';
import { withStoredCredential } from '@/lib/search/server-credentials';
import { isCrossOriginRequest } from '@/lib/security/same-origin';
import { validateServiceUrl } from '@/lib/mcp/url-guard';

/**
 * Search, for callers outside the agent loop (the browser surface, widgets).
 *
 * This route used to be its own search implementation: SearXNG-only, with a
 * hardcoded internal corporate host as the default. That made it the third
 * independent reader of `SEARXNG_INSTANCES` and the one that disagreed — it
 * claimed a search engine while the prompt layer told the model none existed,
 * then failed DNS off that network and returned `{results: []}`, which reads as
 * "the web contains nothing about your query".
 *
 * It now resolves through the same chokepoint as everything else and reports
 * failures as failures. The three states a caller must be able to tell apart:
 *
 *   501 no_search_configured — no provider set up
 *   502 / 401                — a provider is set up and did not answer
 *   200 { results: [] }      — search ran and genuinely found nothing
 *
 * Collapsing those into an empty array is what taught the agent to guess URLs.
 */
export async function POST(req: NextRequest) {
  let body: { query?: string; max_results?: number; settings?: Partial<SearchSettings> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ results: [], error: 'bad_request' }, { status: 400 });
  }

  /*
   * This route takes a fetch TARGET from the request body, so the caller matters.
   *
   * `settings.searchInstanceUrl` reaches `runSearch`, which does
   * `fetch(new URL('/search', instanceUrl))` server-side. The route it replaced
   * read that host from `process.env` only; taking it from the body made it
   * caller-controlled, and the app ships a browser surface, so "the caller" can
   * be any page the user happens to be looking at. A `text/plain` POST needs no
   * preflight, and the distinguishable 401/502/timeout statuses are a working
   * internal port scanner even without reading a single response body.
   */
  if (isCrossOriginRequest(req)) {
    return NextResponse.json({ results: [], error: 'forbidden' }, { status: 403 });
  }

  const query = body.query?.trim();
  if (!query) return NextResponse.json({ results: [] });

  /*
   * A self-hosted instance on a LAN address is an ordinary setup, so this is NOT
   * `validateFetchUrl` — the user typed this address, unlike a URL the model
   * picked out of a search result. Link-local is refused in both, being cloud
   * metadata and never a search engine.
   */
  const instance = (body.settings as { searchInstanceUrl?: unknown } | undefined)?.searchInstanceUrl;
  if (typeof instance === 'string' && instance.trim() !== '') {
    const verdict = validateServiceUrl(instance);
    if (!verdict.ok) {
      return NextResponse.json(
        { results: [], error: 'bad_instance_url', detail: verdict.message },
        { status: 400 },
      );
    }
  }

  // Settings come from the caller (the renderer holds them); env is the legacy
  // fallback so existing SEARXNG_INSTANCES installs keep working.
  const resolved = resolveSearchRoute(body.settings ?? null, process.env, {
    openrouterProviderId:
      (body.settings as { openrouterProviderId?: string | null } | undefined)
        ?.openrouterProviderId ?? null,
  });
  if (!resolved) {
    return NextResponse.json({ results: [], error: 'no_search_configured' }, { status: 501 });
  }
  // A borrowed key is an id here and a secret only on the server — same
  // resolution the agent loop does, so Test exercises the real path.
  const route = await withStoredCredential(resolved);

  try {
    const results = await runSearch(route, query, { maxResults: body.max_results ?? 10 });
    return NextResponse.json({ results, provider: route.providerId });
  } catch (e) {
    const code = e instanceof SearchError ? e.code : 'upstream';
    return NextResponse.json(
      { results: [], error: code, provider: route.providerId },
      { status: code === 'auth' ? 401 : 502 },
    );
  }
}
