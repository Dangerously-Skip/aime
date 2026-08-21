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
  /**
   * Tri-state, and the distinction is load-bearing:
   *
   *   a provider id — use it
   *   `'none'`      — the user turned search OFF and that must stick
   *   `null`        — never chosen; eligible for the default below
   *
   * Collapsing the last two into `null` is the obvious simplification and it is
   * wrong: it would re-enable search every launch for someone who deliberately
   * turned it off, which is spending their money against an explicit choice.
   */
  searchProvider: SearchProviderId | 'none' | null;
  searchApiKey: string | null;
  searchInstanceUrl: string | null;
  /**
   * Borrow the API key stored for this MODEL provider instead of asking for a
   * second copy. Holds an id, never a secret — the secret stays in the
   * server-side credential store and is resolved at the point of use by
   * `withStoredCredential`.
   */
  searchCredentialProviderId?: string | null;
}

export interface SearchRoute {
  providerId: SearchProviderId;
  apiKey?: string;
  instanceUrl?: string;
  /** Resolve the key from this stored provider id — server-side only. */
  credentialProviderId?: string;
  /**
   * The model that CARRIES the OpenRouter web-plugin call.
   *
   * OpenRouter is not a search API — it is a model router, and retrieval happens
   * during inference via the `web` plugin. So a search is a chat completion
   * whose ANNOTATIONS are the payload; the prose is discarded at 64 tokens. The
   * model therefore barely matters, and the cheapest capable one is right.
   *
   * What is NOT right is hardcoding its id. `openai/gpt-4o-mini` was written
   * into `execute.ts`, which never consults the model chokepoint — the same
   * defect as the memory extractor's hardcoded Anthropic id, and it fails the
   * same way: an account that cannot serve that exact id gets a 400 and search
   * silently returns nothing, on every query, with no trace a user would see.
   */
  carrierModel?: string;
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
export interface SearchDefaults {
  /**
   * A configured model provider whose key can also serve search — today that
   * means OpenRouter, whose web plugin is a search backend in its own right.
   *
   * When present and the user has expressed no preference, search defaults ON
   * using this credential. The alternative was leaving it off until someone
   * found the Settings page, which is how the agent ended up with no search at
   * all and started inventing URLs. Reconfigurable, and `'none'` beats it.
   */
  openrouterProviderId?: string | null;
  /** Overrides the web-plugin carrier model. See SearchRoute.carrierModel. */
  searchCarrierModel?: string | null;
}

export function resolveSearchRoute(
  settings: Partial<SearchSettings> | null | undefined,
  env: Record<string, string | undefined> = {},
  defaults: SearchDefaults = {},
): SearchRoute | null {
  const chosen = settings?.searchProvider ?? null;

  // An explicit "off" is final — not a gap for a default to fill.
  if (chosen === 'none') return null;

  if (chosen) {
    const preset = searchProviderPreset(chosen);
    if (!preset) return null;

    const apiKey = settings?.searchApiKey?.trim() || undefined;
    const instanceUrl = settings?.searchInstanceUrl?.trim() || undefined;
    const credentialProviderId = settings?.searchCredentialProviderId?.trim() || undefined;

    // A provider missing a required credential is NOT configured. Returning it
    // anyway would put us back to claiming a search tool that cannot run — the
    // exact shape of the original bug, one layer down.
    for (const field of preset.requires) {
      // A borrowed credential satisfies the apiKey requirement: the secret is
      // not here because it must not be here, not because it is missing.
      if (field === 'apiKey' && !apiKey && !credentialProviderId) return null;
      if (field === 'instanceUrl' && !instanceUrl) return null;
    }
    return { providerId: chosen, apiKey, instanceUrl, credentialProviderId };
  }

  /**
   * Legacy path: `SEARXNG_INSTANCES` predates the Settings surface and is how
   * every existing install is configured. Honoured so upgrading does not
   * silently turn search off, but only as a fallback — an explicit choice in
   * Settings always wins.
   */
  const legacy = env.SEARXNG_INSTANCES?.split(',')[0]?.trim();
  if (legacy) return { providerId: 'searxng', instanceUrl: legacy };

  /**
   * Nothing chosen and nothing in env: fall back to the credential the user
   * already gave for inference, if it can also search. Costs about half a cent
   * a query and needs no setup — versus no search at all, which costs a wrong
   * answer delivered confidently.
   */
  const borrow = defaults.openrouterProviderId?.trim();
  if (borrow) {
    return {
      providerId: 'openrouter',
      credentialProviderId: borrow,
      carrierModel: defaults.searchCarrierModel?.trim() || undefined,
    };
  }

  return null;
}

/** Convenience for the prompt layer, which only needs the boolean. */
export function hasSearch(
  settings: Partial<SearchSettings> | null | undefined,
  env: Record<string, string | undefined> = {},
  defaults: SearchDefaults = {},
): boolean {
  return resolveSearchRoute(settings, env, defaults) !== null;
}
