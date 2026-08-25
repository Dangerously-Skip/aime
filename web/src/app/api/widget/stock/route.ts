import { NextRequest } from 'next/server';
import { fetchYahooChart } from '@/lib/widgets/quote-upstream';

export const runtime = 'nodejs';

/**
 * GET /api/widget/stock?symbol=XYZ
 *
 * Server-side proxy for Yahoo Finance chart data — Yahoo doesn't return
 * Access-Control-Allow-Origin so the renderer can't fetch it directly.
 *
 * The fetch and its symbol whitelist live in `quote-upstream` because the
 * widget scheduler needs the same call without a proxy to route it through.
 */
export async function GET(req: NextRequest) {
  const result = await fetchYahooChart(req.nextUrl.searchParams.get('symbol') ?? '');
  if (result.error) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data, { headers: { 'Cache-Control': 'public, s-maxage=60' } });
}
