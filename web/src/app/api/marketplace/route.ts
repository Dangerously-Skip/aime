import type { MarketplacePlugin } from '@/lib/marketplace';

export const runtime = 'nodejs';

const MARKETPLACE_URL =
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';

let cachedPlugins: MarketplacePlugin[] | null = null;
let cachedAt = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * The directory, or `null` when it could not be loaded and nothing is cached.
 *
 * This used to return `[]` on failure, and a 200 with an empty list is
 * indistinguishable from a directory with nothing in it: the Marketplace said
 * "No plugins match your search." to someone who had not searched, offline or
 * rate-limited, with no way to try again. Failure is now its own value so the
 * route can say so.
 */
async function fetchPlugins(): Promise<MarketplacePlugin[] | null> {
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
    const plugins: MarketplacePlugin[] = Array.isArray(data?.plugins) ? data.plugins : [];
    cachedPlugins = plugins;
    cachedAt = now;
    return plugins;
  } catch (err) {
    console.error('[Marketplace] Fetch error:', err);
    // Stale beats nothing: a directory from an hour ago is still useful.
    return cachedPlugins;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.toLowerCase() || '';

  const loaded = await fetchPlugins();
  if (loaded === null) {
    return Response.json(
      { error: "Couldn't reach the plugin directory. Check your connection and try again." },
      { status: 502 },
    );
  }

  let plugins = loaded;
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
