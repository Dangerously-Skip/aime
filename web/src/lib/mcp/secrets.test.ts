import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  extractSecrets,
  injectSecrets,
  hasInlineSecrets,
  isEmptySecrets,
  secretKeyForServer,
  SECRET_PLACEHOLDER,
} from './secrets';

/**
 * The invariant that matters: after extraction the entry must contain no secret
 * material, and injection must reproduce the original exactly. Both are asserted
 * as properties, because the interesting cases are entry shapes I would not
 * hand-write.
 */

const stdio = () => ({
  transport: 'stdio',
  command: 'node',
  args: ['/opt/aime/mcp-servers/google/index.mjs'],
  env: { GOOGLE_ACCESS_TOKEN: 'ya29.real-token' },
  _meta: {
    connectorId: 'google-personal',
    clientId: 'public-client-id',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    expiresAt: 1700000000000,
    refreshToken: '1//real-refresh',
    clientSecret: 'GOCSPX-real-secret',
  },
});

const http = () => ({
  transport: 'streamable-http',
  url: 'https://api.githubcopilot.com/mcp/',
  headers: { Authorization: 'Bearer ghp_realtoken' },
  _meta: { connectorId: 'github' },
});

describe('extractSecrets — nothing secret survives on disk', () => {
  it('lifts a stdio env token, keeping the variable NAME visible', () => {
    const { entry, secrets } = extractSecrets(stdio());

    expect(secrets.env).toEqual({ GOOGLE_ACCESS_TOKEN: 'ya29.real-token' });
    // the name is structure the file should still document
    expect(entry.env).toEqual({ GOOGLE_ACCESS_TOKEN: SECRET_PLACEHOLDER });
    expect(JSON.stringify(entry)).not.toContain('ya29.real-token');
  });

  it('lifts a bearer token but keeps the scheme prefix', () => {
    const { entry, secrets } = extractSecrets(http());

    expect(secrets.headers).toEqual({ Authorization: 'ghp_realtoken' });
    // "Bearer " is protocol, not secret — dropping it would break the request
    expect(entry.headers).toEqual({ Authorization: `Bearer ${SECRET_PLACEHOLDER}` });
    expect(JSON.stringify(entry)).not.toContain('ghp_realtoken');
  });

  it('lifts the refresh token and client secret out of _meta', () => {
    const { entry, secrets } = extractSecrets(stdio());

    expect(secrets.refreshToken).toBe('1//real-refresh');
    expect(secrets.clientSecret).toBe('GOCSPX-real-secret');
    const meta = entry._meta as Record<string, unknown>;
    expect('refreshToken' in meta).toBe(false);
    expect('clientSecret' in meta).toBe(false);
  });

  it('leaves genuinely public metadata alone', () => {
    // A public OAuth client_id, the token endpoint and the expiry are not secret,
    // and refresh needs them without a store round-trip.
    const { entry } = extractSecrets(stdio());
    expect(entry._meta).toMatchObject({
      connectorId: 'google-personal',
      clientId: 'public-client-id',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      expiresAt: 1700000000000,
    });
  });

  it('leaves transport, command, args and url untouched', () => {
    const original = stdio();
    const { entry } = extractSecrets(original);
    expect(entry.transport).toBe('stdio');
    expect(entry.command).toBe('node');
    expect(entry.args).toEqual(original.args);
  });

  it('is idempotent — re-running does not blank an already-split entry', () => {
    const once = extractSecrets(stdio());
    const twice = extractSecrets(once.entry);
    expect(twice.entry).toEqual(once.entry);
    expect(isEmptySecrets(twice.secrets)).toBe(true);
  });

  it('finds nothing in an entry that has no credentials (aws_iam)', () => {
    const { secrets } = extractSecrets({ transport: 'stdio', command: 'uvx', args: ['x'] });
    expect(isEmptySecrets(secrets)).toBe(true);
  });

  it('ignores empty string values rather than storing them', () => {
    const { secrets } = extractSecrets({ env: { TOKEN: '' }, headers: { Authorization: '' } });
    expect(isEmptySecrets(secrets)).toBe(true);
  });
});

describe('injectSecrets — the SDK gets a working entry back', () => {
  it('round-trips a stdio entry exactly', () => {
    const original = stdio();
    const { entry, secrets } = extractSecrets(original);
    expect(injectSecrets(entry, secrets)).toEqual(original);
  });

  it('round-trips an http entry exactly', () => {
    const original = http();
    const { entry, secrets } = extractSecrets(original);
    expect(injectSecrets(entry, secrets)).toEqual(original);
  });

  it('leaves the placeholder in place when the secret is missing', () => {
    // An empty credential would reach the service and come back as a confusing
    // 401; the sentinel makes the real cause visible in a log.
    const { entry } = extractSecrets(http());
    const result = injectSecrets(entry, {});
    expect((result.headers as Record<string, string>).Authorization).toContain(SECRET_PLACEHOLDER);
  });

  it('is a no-op when there are no secrets at all', () => {
    const entry = { transport: 'stdio', command: 'x' };
    expect(injectSecrets(entry, undefined)).toBe(entry);
  });

  it('does not mutate its input', () => {
    const original = stdio();
    const snapshot = JSON.parse(JSON.stringify(original));
    extractSecrets(original);
    expect(original).toEqual(snapshot);
  });

  it('restores refresh metadata so the refresh path still works', () => {
    const { entry, secrets } = extractSecrets(stdio());
    const restored = injectSecrets(entry, secrets);
    expect((restored._meta as Record<string, unknown>).refreshToken).toBe('1//real-refresh');
  });
});

describe('properties', () => {
  const entryArb = fc.record(
    {
      transport: fc.constantFrom('stdio', 'streamable-http', 'sse'),
      command: fc.option(fc.string(), { nil: undefined }),
      url: fc.option(fc.webUrl(), { nil: undefined }),
      env: fc.option(
        fc.dictionary(fc.constantFrom('A_TOKEN', 'B_KEY'), fc.string({ minLength: 8 })),
        { nil: undefined },
      ),
      headers: fc.option(
        fc.dictionary(
          fc.constantFrom('Authorization', 'X-Api-Key'),
          fc.string({ minLength: 8 }).map((s) => `Bearer ${s}`),
        ),
        { nil: undefined },
      ),
      _meta: fc.option(
        fc.record({
          connectorId: fc.string(),
          refreshToken: fc.option(fc.string({ minLength: 8 }), { nil: undefined }),
          clientSecret: fc.option(fc.string({ minLength: 8 }), { nil: undefined }),
        }),
        { nil: undefined },
      ),
    },
    { requiredKeys: ['transport'] },
  );

  it('extract → inject always reproduces the original', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const { entry: pub, secrets } = extractSecrets(entry as Record<string, unknown>);
        expect(injectSecrets(pub, secrets)).toEqual(entry);
      }),
      { numRuns: 500 },
    );
  });

  it('every extracted secret value is absent from the written entry', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const { entry: pub, secrets } = extractSecrets(entry as Record<string, unknown>);
        const onDisk = JSON.stringify(pub);
        // Flatten the env/header maps as well as the scalar fields — checking
        // only Object.values(secrets) silently skipped both maps.
        const values = [
          ...Object.values(secrets.env ?? {}),
          ...Object.values(secrets.headers ?? {}),
          secrets.refreshToken,
          secrets.clientSecret,
        ];
        for (const value of values) {
          if (typeof value !== 'string' || value.trim() === '') continue;
          expect(onDisk, `leaked: ${JSON.stringify(value)}`).not.toContain(value);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('extraction is always idempotent', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const once = extractSecrets(entry as Record<string, unknown>);
        const twice = extractSecrets(once.entry);
        expect(twice.entry).toEqual(once.entry);
        expect(isEmptySecrets(twice.secrets)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe('hasInlineSecrets / secretKeyForServer', () => {
  it('detects an unmigrated entry and a migrated one', () => {
    expect(hasInlineSecrets(stdio())).toBe(true);
    expect(hasInlineSecrets(extractSecrets(stdio()).entry)).toBe(false);
  });

  it('namespaces store keys so they cannot collide with provider credentials', () => {
    // The same store holds BYOK provider keys under bare ids like 'anthropic'.
    expect(secretKeyForServer('aime-connector-github')).toBe('mcp:aime-connector-github');
    expect(secretKeyForServer('anthropic')).not.toBe('anthropic');
  });
});

describe('regression: dollar signs in credentials', () => {
  /**
   * String.replace interprets `$$`, `$&`, `` $` `` and `$1` inside a REPLACEMENT
   * STRING. Injecting with a plain string therefore corrupted any token
   * containing a dollar sign — silently, and only on the way to the service, so
   * it would have surfaced as an inexplicable 401. Found by the round-trip
   * property, not by hand.
   */
  it.each([
    ['$$', 'doubled dollar becomes one'],
    ['$&', 'match placeholder'],
    ['a$`b', 'backtick placeholder'],
    ["x$'y", 'after-match placeholder'],
    ['$1$2', 'group references'],
    ['pat$word$123', 'realistic API key'],
  ])('survives a header credential of %j (%s)', (credential) => {
    const original = {
      transport: 'streamable-http',
      url: 'https://x/mcp',
      headers: { Authorization: `Bearer ${credential}` },
    };
    const { entry, secrets } = extractSecrets(original);
    expect(secrets.headers).toEqual({ Authorization: credential });
    expect(injectSecrets(entry, secrets)).toEqual(original);
  });

  it('survives a dollar sign in an env credential', () => {
    const original = { transport: 'stdio', env: { API_TOKEN: 'a$$b$&c' } };
    const { entry, secrets } = extractSecrets(original);
    // env values are assigned directly, not via replace, but pin it anyway
    expect(injectSecrets(entry, secrets)).toEqual(original);
  });
});
