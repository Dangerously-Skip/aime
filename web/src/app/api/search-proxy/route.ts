import { NextRequest, NextResponse } from 'next/server';
import { APP_NAME } from '@/config/branding';

/**
 * No default instance, deliberately.
 *
 * This used to fall back to a hardcoded internal corporate SearXNG host — a
 * leftover from before the open-source rename. Two things were wrong with it: it
 * shipped a private hostname in a public repo, and it made this route disagree
 * with the rest of the app. `claude-provider` mounts the `web-search` MCP only
 * when `SEARXNG_INSTANCES` is set, and `hasWebSearchMcp()` reports search as
 * unavailable on that same basis — while this route claimed to have one, then
 * failed DNS for everyone outside that network and returned `{results: []}`,
 * which is indistinguishable from "the web knows nothing about your query".
 *
 * Unset now means unset: the route reports it rather than pretending.
 */
const SEARXNG_URL = process.env.SEARXNG_INSTANCES ?? '';

export async function POST(req: NextRequest) {
  try {
    const { query, max_results = 10 } = await req.json();
    if (!query) return NextResponse.json({ results: [] });

    const instance = SEARXNG_URL.split(',')[0].trim();
    // Distinguishable from a real empty result set, so a caller can tell "no
    // search configured" from "search found nothing" — the whole point of the
    // change above.
    if (!instance) {
      return NextResponse.json(
        { results: [], error: 'no_search_configured' },
        { status: 501 },
      );
    }
    const resp = await fetch(new URL('/search', instance).toString(), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': `${APP_NAME}/1.0`,
      },
      body: new URLSearchParams({
        q: query,
        format: 'json',
        pageno: '1',
        language: 'all',
        safesearch: '0',
      }).toString(),
      // @ts-expect-error Node fetch supports rejectUnauthorized via agent
      agent: undefined,
    });

    if (!resp.ok) return NextResponse.json({ results: [] });

    const data = await resp.json();
    const results = (data.results || []).slice(0, max_results).map((r: Record<string, unknown>) => ({
      title: String(r.title || ''),
      url: String(r.url || ''),
      snippet: String(r.content || r.snippet || '').slice(0, 200),
    })).filter((r: { title: string; url: string }) => r.title && r.url);

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
