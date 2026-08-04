/**
 * Search providers — the same shape as `lib/models/providers.ts`, on purpose.
 *
 * Models already solved this exact problem here: BYOK providers populate a
 * catalog, one Settings surface chooses, one resolver is the chokepoint, and
 * source-derived tests stop a surface from going around it. Search was the
 * second capability to need all four and had none of them — it was a single
 * `SEARXNG_INSTANCES` env var, read directly in three places that could
 * disagree, with a hardcoded corporate host as its default.
 *
 * So this is deliberately not a new subsystem. It is the model subsystem's
 * shape applied to a second capability, so that there is one thing to learn.
 *
 * ## Why every provider reduces to the same call
 *
 * The four backends are not alike underneath. SearXNG is a metasearch proxy,
 * Brave and Tavily are REST search APIs, and OpenRouter is a model router whose
 * `:online` plugin does retrieval during inference and hands back citations
 * rather than a result list. Exposing those differences to callers would put a
 * four-way branch in every surface.
 *
 * They do all answer the same question — "what pages are relevant to this
 * string" — so the registry flattens them to `query -> SearchResult[]` and the
 * differences live in `execute.ts`. A surface asks for search and gets search.
 */

/** A single result, uniform across every backend. */
export interface SearchResult {
  title: string;
  url: string;
  /** Extract or summary. Trimmed — a whole page here would swamp the context. */
  snippet: string;
}

export type SearchProviderId = 'searxng' | 'brave' | 'tavily' | 'openrouter';

/** What the user must supply before a provider can be used. */
export type SearchCredentialField = 'apiKey' | 'instanceUrl';

export interface SearchProviderPreset {
  id: SearchProviderId;
  label: string;
  /** Shown in Settings. Should say what it costs and what it needs. */
  description: string;
  /** Fields with no value ⇒ the provider is not configured. */
  requires: SearchCredentialField[];
  /** Where to get the credential. Shown as a link in Settings. */
  signupUrl?: string;
  /**
   * True when the credential is one the user may already hold for INFERENCE.
   * Drives the Settings ordering: a provider needing no new account is the one
   * to offer first.
   */
  reusesModelCredential?: boolean;
}

/**
 * Ordered by what a new user should try first, not alphabetically.
 *
 * OpenRouter leads because it is the only entry that can be configured with a
 * credential the user already has — this app's BYOK story means an OpenRouter
 * key is the common case, and `:online` works against any model slug. Every
 * other option is a second account.
 */
export const SEARCH_PROVIDERS: SearchProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter web search',
    description:
      'Uses the OpenRouter key you may already have for models. Roughly $0.005 per ' +
      'search for 10 results. No extra account.',
    requires: ['apiKey'],
    signupUrl: 'https://openrouter.ai/keys',
    reusesModelCredential: true,
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description: 'Built for agents; returns clean extracts. Free tier available.',
    requires: ['apiKey'],
    signupUrl: 'https://tavily.com',
  },
  {
    id: 'brave',
    label: 'Brave Search',
    description:
      'Independent index. Note: as of 2026 new accounts get metered credits rather ' +
      'than a free tier, and a card is required.',
    requires: ['apiKey'],
    signupUrl: 'https://brave.com/search/api/',
  },
  {
    id: 'searxng',
    label: 'SearXNG (self-hosted)',
    description:
      'Point at your own SearXNG instance. No API key and no per-query cost, but ' +
      'you host it — most public instances disable the JSON API this needs.',
    requires: ['instanceUrl'],
    signupUrl: 'https://docs.searxng.org/admin/installation-docker.html',
  },
];

export function searchProviderPreset(id: string): SearchProviderPreset | undefined {
  return SEARCH_PROVIDERS.find((p) => p.id === id);
}
