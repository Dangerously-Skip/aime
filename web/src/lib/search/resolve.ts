import { searchProviderPreset, type SearchProviderId } from './providers';

/**
 * THE search chokepoint. Everything that needs to know whether search exists —
 * the system prompt, the MCP mounting, the proxy route — asks this and nothing
 * else.
 *
 * Before this existed there were three independent readers of
 * `process.env.SEARXNG_INSTANCES`, and they disagreed in production:
 * `claude-provider` mounted the MCP only when it was set, `hasWebSearchMcp()`
 * reported availability on the same basis, and `search-proxy` fell back to a
 * hardcoded internal host — so the route claimed a search engine the prompt had
 * just told the model did not exist. The user saw an agent inventing URLs.
 *
 * That is the same failure the model layer had and fixed: a surface resolving
 * its own route instead of going through one function. `send-route-coverage`
 * enforces it there; `search-route-coverage` enforces it here.
 */

export interface SearchSettings {
  /** Null ⇒ the user has not chosen a provider. Not an error; search is opt-in. */
  searchProvider: SearchProviderId | null;
  searchApiKey: string | null;
  searchInstanceUrl: string | null;
}

export interface SearchRoute {
  providerId: SearchProviderId;
  apiKey?: string;
  instanceUrl?: string;
}

/**
 * The active search route, or `null` when search is unavailable.
 *
 * `null` is a first-class answer, not a failure. Search is opt-in, most installs
 * will not have it, and the honest prompt branch depends on knowing that
 * reliably. A resolver that guessed a default would recreate the bug it exists
 * to prevent.
 *
 * @param settings the user's stored choice (client) or its server-side mirror
 * @param env      process env, for the legacy `SEARXNG_INSTANCES` path
 */
export function resolveSearchRoute(
  settings: Partial<SearchSettings> | null | undefined,
  env: Record<string, string | undefined> = {},
): SearchRoute | null {
  const chosen = settings?.searchProvider ?? null;

  if (chosen) {
    const preset = searchProviderPreset(chosen);
    if (!preset) return null;

    const apiKey = settings?.searchApiKey?.trim() || undefined;
    const instanceUrl = settings?.searchInstanceUrl?.trim() || undefined;

    // A provider missing a required credential is NOT configured. Returning it
    // anyway would put us back to claiming a search tool that cannot run — the
    // exact shape of the original bug, one layer down.
    for (const field of preset.requires) {
      if (field === 'apiKey' && !apiKey) return null;
      if (field === 'instanceUrl' && !instanceUrl) return null;
    }
    return { providerId: chosen, apiKey, instanceUrl };
  }

  /**
   * Legacy path: `SEARXNG_INSTANCES` predates the Settings surface and is how
   * every existing install is configured. Honoured so upgrading does not
   * silently turn search off, but only as a fallback — an explicit choice in
   * Settings always wins.
   */
  const legacy = env.SEARXNG_INSTANCES?.split(',')[0]?.trim();
  if (legacy) return { providerId: 'searxng', instanceUrl: legacy };

  return null;
}

/** Convenience for the prompt layer, which only needs the boolean. */
export function hasSearch(
  settings: Partial<SearchSettings> | null | undefined,
  env: Record<string, string | undefined> = {},
): boolean {
  return resolveSearchRoute(settings, env) !== null;
}
