import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl } from './oauth';
import { CONNECTOR_MAP, CONNECTOR_REGISTRY } from './registry';

/**
 * Runs against the real registry: the point of these tests is that the shipped
 * connector definitions produce authorization URLs that actually work, which a
 * fixture connector could not tell us.
 */

const opts = {
  clientId: 'cid',
  redirectUri: 'http://localhost:3000/api/connectors/oauth/callback',
  state: 'st',
  codeChallenge: 'chal',
};

const paramsFor = (id: string) =>
  new URL(buildAuthorizeUrl(CONNECTOR_MAP[id], opts)).searchParams;

describe('buildAuthorizeUrl — Google refresh tokens', () => {
  it.each(['google-workspace', 'google-personal'])(
    '%s requests offline access so a refresh_token is issued',
    (id) => {
      const p = paramsFor(id);
      // Without access_type=offline Google returns no refresh_token at all and
      // the connection dies ~1h after connecting.
      expect(p.get('access_type')).toBe('offline');
      // Without prompt=consent, re-authorising an already-consented account
      // returns no refresh_token either.
      expect(p.get('prompt')).toBe('consent');
    },
  );

  it('does not add offline access to providers that did not ask for it', () => {
    expect(paramsFor('zoom').get('access_type')).toBeNull();
    expect(paramsFor('m365-graph').get('access_type')).toBeNull();
  });
});

describe('buildAuthorizeUrl — standard parameters', () => {
  it('sends the standard authorization-code parameters', () => {
    const p = paramsFor('google-personal');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe(opts.redirectUri);
    expect(p.get('response_type')).toBe('code');
    // state is namespaced by connector so the callback can route it
    expect(p.get('state')).toBe('google-personal:st');
  });

  it('includes the PKCE challenge when one is supplied', () => {
    const p = paramsFor('google-personal');
    expect(p.get('code_challenge')).toBe('chal');
    expect(p.get('code_challenge_method')).toBe('S256');
  });

  it('omits PKCE parameters when no challenge is supplied', () => {
    const url = buildAuthorizeUrl(CONNECTOR_MAP['zoom'], { ...opts, codeChallenge: undefined });
    const p = new URL(url).searchParams;
    expect(p.get('code_challenge')).toBeNull();
    expect(p.get('code_challenge_method')).toBeNull();
  });

  it('space-separates scopes for ordinary providers', () => {
    const scope = paramsFor('google-personal').get('scope');
    expect(scope).toBe(CONNECTOR_MAP['google-personal'].auth.scopes!.join(' '));
  });

  it('throws for a connector with no authUrl rather than building a bad URL', () => {
    expect(() => buildAuthorizeUrl(CONNECTOR_MAP['github'], opts)).toThrow(/no authUrl/);
  });
});

describe('every oauth2 connector produces a valid authorize URL', () => {
  const oauth2 = CONNECTOR_REGISTRY.filter((c) => c.auth.type === 'oauth2');

  it('has at least the four oauth2 connectors we expect', () => {
    expect(oauth2.length).toBeGreaterThanOrEqual(4);
  });

  it.each(oauth2.map((c) => c.id))('%s builds a parseable https URL with a client_id', (id) => {
    const url = buildAuthorizeUrl(CONNECTOR_MAP[id], opts);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('state')).toBe(`${id}:st`);
  });

  it('any connector declaring a refreshable oauth2 flow asks for what it needs', () => {
    // Pins the rule rather than the current list: if a connector has a tokenUrl
    // on accounts.google.com it must request offline access.
    for (const c of oauth2) {
      if (c.auth.authUrl?.includes('accounts.google.com')) {
        expect(c.auth.extraAuthParams?.access_type, `${c.id} needs access_type=offline`).toBe(
          'offline',
        );
      }
    }
  });
});
