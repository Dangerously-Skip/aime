import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/widget/stock?symbol=XYZ
 * Server-side proxy for Yahoo Finance chart data — Yahoo doesn't return
 * Access-Control-Allow-Origin so we can't fetch directly from the renderer.
 */
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return Response.json({ error: 'symbol required' }, { status: 400 });
  }
  // Whitelist a small character set so we never proxy arbitrary URLs.
  if (!/^[A-Za-z0-9._%=\-^]+$/.test(symbol)) {
    return Response.json({ error: 'invalid symbol' }, { status: 400 });
  }
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  try {
    const res = await fetch(upstream, {
      headers: {
        // Yahoo blocks default fetch user-agents.
        'User-Agent': 'Mozilla/5.0 (Quarry) AppleWebKit/605.1.15',
      },
    });
    if (!res.ok) {
      return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
