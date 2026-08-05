import { describe, it, expect } from 'vitest';
import { resolveSearchRoute, hasSearch } from './resolve';
import { SEARCH_PROVIDERS } from './providers';

/**
 * The resolver's job is to be the single answer to "does search exist", so the
 * cases that matter are the ones where a wrong answer is worse than no answer.
 *
 * A false positive here is the original bug: the prompt tells the model it has
 * search, the tool is not usable, and the model falls back to reciting URLs from
 * training. So "configured but missing its credential" must resolve to null, not
 * to a route that fails later.
 */

describe('resolveSearchRoute', () => {
  it('is null when nothing is configured — opt-in, not an error', () => {
    expect(resolveSearchRoute(null, {})).toBeNull();
    expect(resolveSearchRoute({ searchProvider: null }, {})).toBeNull();
    expect(hasSearch(null, {})).toBe(false);
  });

  it('resolves an api-key provider once the key is present', () => {
    const r = resolveSearchRoute({ searchProvider: 'brave', searchApiKey: 'bsk_x' }, {});
    expect(r).toEqual({ providerId: 'brave', apiKey: 'bsk_x', instanceUrl: undefined });
  });

  /**
   * The load-bearing case. Choosing a provider in Settings and not finishing is
   * the most likely half-configured state, and it must read as "no search".
   */
  it.each(SEARCH_PROVIDERS.map((p) => [p.id, p.requires] as const))(
    '%s selected with no credential is NOT a route',
    (id) => {
      expect(resolveSearchRoute({ searchProvider: id }, {})).toBeNull();
      expect(resolveSearchRoute({ searchProvider: id, searchApiKey: '   ' }, {})).toBeNull();
      expect(resolveSearchRoute({ searchProvider: id, searchInstanceUrl: '  ' }, {})).toBeNull();
    },
  );

  it('rejects a provider id that is not in the catalog', () => {
    // Cast: the point is a persisted value from a newer build, or a typo.
    expect(
      resolveSearchRoute({ searchProvider: 'bing' as never, searchApiKey: 'k' }, {}),
    ).toBeNull();
  });

  describe('default on, when a credential already exists', () => {
    const OR = { openrouterProviderId: 'prov-or-1' };

    /**
     * The decision this encodes: search on by default when the user already has
     * a key that can serve it. Left opt-in, it stayed off, the agent had no
     * search at all, and it filled the gap by inventing URLs.
     */
    it('borrows the OpenRouter credential when nothing has been chosen', () => {
      const r = resolveSearchRoute(null, {}, OR);
      expect(r).toEqual({ providerId: 'openrouter', credentialProviderId: 'prov-or-1' });
    });

    /**
     * The half that makes a default acceptable: turning it off has to stick.
     * Re-enabling it each launch would be spending someone's money against an
     * explicit instruction, which is why `'none'` and `null` are different
     * values rather than one nullable field.
     */
    it('respects an explicit "none" and does NOT re-enable', () => {
      expect(resolveSearchRoute({ searchProvider: 'none' }, {}, OR)).toBeNull();
      expect(hasSearch({ searchProvider: 'none' }, {}, OR)).toBe(false);
    });

    it('an explicit provider still wins over the default', () => {
      const r = resolveSearchRoute({ searchProvider: 'tavily', searchApiKey: 'tvly' }, {}, OR);
      expect(r?.providerId).toBe('tavily');
    });

    it('env search still wins over the default — it was configured deliberately', () => {
      const r = resolveSearchRoute(null, { SEARXNG_INSTANCES: 'https://s.example' }, OR);
      expect(r?.providerId).toBe('searxng');
    });

    it('does nothing without a borrowable provider', () => {
      expect(resolveSearchRoute(null, {}, {})).toBeNull();
      expect(resolveSearchRoute(null, {}, { openrouterProviderId: '  ' })).toBeNull();
    });
  });

  describe('the legacy env path', () => {
    it('keeps an existing SEARXNG_INSTANCES install working', () => {
      const r = resolveSearchRoute(null, { SEARXNG_INSTANCES: 'https://searx.example' });
      expect(r).toEqual({ providerId: 'searxng', instanceUrl: 'https://searx.example' });
    });

    it('takes the first of a comma-separated list', () => {
      const r = resolveSearchRoute(null, { SEARXNG_INSTANCES: 'https://a.example, https://b.example' });
      expect(r?.instanceUrl).toBe('https://a.example');
    });

    /**
     * Settings is the chokepoint; env is a fallback for installs that predate
     * it. If env won, a user could not change their mind in the UI.
     */
    it('loses to an explicit choice in Settings', () => {
      const r = resolveSearchRoute(
        { searchProvider: 'tavily', searchApiKey: 'tvly_x' },
        { SEARXNG_INSTANCES: 'https://searx.example' },
      );
      expect(r?.providerId).toBe('tavily');
    });

    /**
     * A half-configured Settings choice must not silently fall through to the
     * env provider — the user would get results from a source they did not
     * pick, which is worse than getting none.
     */
    it('does not rescue a half-configured Settings choice', () => {
      const r = resolveSearchRoute(
        { searchProvider: 'tavily', searchApiKey: null },
        { SEARXNG_INSTANCES: 'https://searx.example' },
      );
      expect(r).toBeNull();
    });

    it('ignores an empty env var', () => {
      expect(resolveSearchRoute(null, { SEARXNG_INSTANCES: '  ' })).toBeNull();
    });
  });
});
