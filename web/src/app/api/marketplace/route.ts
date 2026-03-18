import type { MarketplacePlugin } from '@/lib/marketplace';

export const runtime = 'nodejs';

const MARKETPLACE_URL =
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';

let cachedPlugins: MarketplacePlugin[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function fetchPlugins(): Promise<MarketplacePlugin[]> {
  const now = Date.now();
  if (cachedPlugins && now - cachedAt < CACHE_TTL) {
    return cachedPlugins;
  }

  try {
    const res = await fetch(MARKETPLACE_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedPlugins = data.plugins || [];
    cachedAt = now;
    return cachedPlugins!;
  } catch (err) {
    console.error('[Marketplace] Fetch error:', err);
    // Return stale cache if available
    if (cachedPlugins) return cachedPlugins;
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.toLowerCase() || '';

  let plugins = await fetchPlugins();

  if (search) {
    plugins = plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search) ||
        (p.category || '').toLowerCase().includes(search) ||
        (p.keywords || []).some((k) => k.toLowerCase().includes(search)) ||
        (p.tags || []).some((t) => t.toLowerCase().includes(search))
    );
  }

  const categories = Array.from(
    new Set(plugins.map((p) => p.category).filter(Boolean))
  ) as string[];

  return Response.json({ plugins, categories });
}
