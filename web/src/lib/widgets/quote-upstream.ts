import { APP_NAME } from '@/config/branding';

/**
 * The Yahoo chart call, in one place.
 *
 * The renderer must go through `/api/widget/stock` because Yahoo sends no
 * `Access-Control-Allow-Origin`. The SERVER has no such problem and no proxy to
 * call — a relative `/api/...` URL does not resolve in the scheduler process,
 * so a ticker refreshed on its schedule silently returned nothing while the
 * same widget refreshed by hand worked.
 *
 * Both paths now share this function, which means the symbol whitelist is
 * shared too. That matters more than the duplication: the route validates
 * because it is a proxy, and a second copy that forgot to would be an open
 * redirect into `query1.finance.yahoo.com`'s URL space.
 */

/** Yahoo symbols: `AAPL`, `^GSPC`, `BTC-USD`, `AUDUSD=X`, `BRK.B`. */
const SYMBOL = /^[A-Za-z0-9._%=\-^]+$/;

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL.test(symbol);
}

export interface QuoteFetchResult {
  data?: unknown;
  error?: string;
  status: number;
}

export async function fetchYahooChart(symbol: string): Promise<QuoteFetchResult> {
  if (!symbol) return { error: 'symbol required', status: 400 };
  if (!isValidSymbol(symbol)) return { error: 'invalid symbol', status: 400 };

  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
  try {
    const res = await fetch(upstream, {
      // Yahoo blocks default fetch user-agents.
      headers: { 'User-Agent': `Mozilla/5.0 (${APP_NAME}) AppleWebKit/605.1.15` },
    });
    if (!res.ok) return { error: `upstream ${res.status}`, status: 502 };
    return { data: await res.json(), status: 200 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'fetch failed', status: 502 };
  }
}
