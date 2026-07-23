import { NextRequest, NextResponse } from 'next/server';
import { APP_NAME } from '@/config/branding';

const SEARXNG_URL = process.env.SEARXNG_INSTANCES || 'https://ai-studio-searxng.internal.invalid';

export async function POST(req: NextRequest) {
  try {
    const { query, max_results = 10 } = await req.json();
    if (!query) return NextResponse.json({ results: [] });

    const instance = SEARXNG_URL.split(',')[0].trim();
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
