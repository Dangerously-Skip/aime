import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  extractSecrets,
  injectSecrets,
  hasUnresolvedSecrets,
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

const SECRETS_REFRESH = '1//real-refresh';
const SECRETS_CLIENT = 'GOCSPX-real-secret';

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
    refreshToken: SECRETS_REFRESH,
    clientSecret: SECRETS_CLIENT,
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
  it('round-trips the credential the server must present', () => {
    const original = stdio();
    const { entry, secrets } = extractSecrets(original);
    const restored = injectSecrets(entry, secrets);
    // env is what a stdio server actually needs back
    expect(restored.env).toEqual(original.env);
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

  it('does NOT restore _meta secrets — they would reach the CLI argv', () => {
    // The SDK serialises mcpServers into `--mcp-config <json>`, so anything left
    // in the returned object is visible in `ps auxww`. An earlier version put the
    // long-lived refresh token and client secret straight back, which made
    // exposure worse than before the commit that removed plaintext secrets.
    const { entry, secrets } = extractSecrets(stdio());
    const restored = injectSecrets(entry, secrets);
    const serialised = JSON.stringify(restored);

    expect(serialised).not.toContain(SECRETS_REFRESH);
    expect(serialised).not.toContain(SECRETS_CLIENT);
    // …while the access token the server must present is still there
    expect(serialised).toContain('ya29.real-token');
  });

  it('refresh still works, because it reads the store rather than this object', () => {
    // Pinning the contract that made dropping _meta safe.
    const { secrets } = extractSecrets(stdio());
    expect(secrets.refreshToken).toBe(SECRETS_REFRESH);
    expect(secrets.clientSecret).toBe(SECRETS_CLIENT);
  });
});

describe('properties', () => {
  /**
   * WHY TWO OF THESE ARE NOT "does the secret string appear anywhere?" SEARCHES.
   *
   * They were, and they were flaky — 2 failures in 30 runs of this file. fast-check
   * draws a fresh seed per run, so the failure is seed-dependent rather than
   * intermittent, and both counterexamples reproduce with an explicit seed:
   *
   *   seed 1  → {transport:'stdio', headers:{Authorization:'Bearer rototype'},
   *              _meta:{connectorId:'', refreshToken:'rototype'}}
   *   seed 44 → {transport:'stdio', command:'', headers:{Authorization:'Bearer        _'}}
   *
   * Neither is a leak. The code is right in both cases; the SEARCH could not tell
   * a leak from a coincidence, for two separate reasons:
   *
   * 1. COLLISION BETWEEN INDEPENDENT VALUES. fast-check biases `fc.string()`
   *    toward a 22-entry corpus of prototype-pollution names (see
   *    `SlicesForStringBuilder`'s `dangerousStrings`: '__proto__', 'prototype',
   *    'constructor', '__lookupSetter__', …). EVERY string in this arbitrary is
   *    drawn from that same small pool — env values, header credentials,
   *    refreshToken, clientSecret, command, connectorId — so two of them share a
   *    substring regularly. At seed 1 the refresh token and the Authorization
   *    credential were both 'rototype'; another run produced clientSecret
   *    'lookupSe' sitting inside the credential 'lookupSe        '.
   *    `injectSecrets` then correctly restores the header credential — which the
   *    server MUST present — and the search blamed that header for containing the
   *    refresh token.
   *
   * 2. A SECRET SHORTER THAN THE SENTINEL'S OWN ALPHABET. `${AIME_SECRET}` contains
   *    '_', 'A', 'I', 'M', 'E', 'S', 'C', 'R', 'T', '$', '{' and '}'. At seed 44
   *    the extracted credential WAS '_': the header read 'Bearer        _', and
   *    `extractSecrets`' greedy `(Bearer\s+)` prefix absorbs all that whitespace,
   *    leaving a one-character credential. Searching the written entry for '_'
   *    finds it inside the very sentinel that replaced it.
   *
   * So the invariant is asserted STRUCTURALLY instead — which slot holds what, and
   * what else moved — and the substring search is kept only where the haystack
   * cannot collide by construction. That is strictly STRONGER than the original: it
   * pins the exact shape of the written entry instead of hoping a random string
   * does not recur. No seed is pinned, because there is no counterexample to hide.
   */
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

  it('extract → inject always reproduces env and headers exactly', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const original = entry as Record<string, unknown>;
        const { entry: pub, secrets } = extractSecrets(original);
        const restored = injectSecrets(pub, secrets);
        // The credential the server presents must survive byte-for-byte.
        if (original.env) expect(restored.env).toEqual(original.env);
        if (original.headers) expect(restored.headers).toEqual(original.headers);
      }),
      { numRuns: 500 },
    );
  });

  it('property: no _meta secret ever survives into the SDK-facing object', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const original = entry as Record<string, unknown>;
        const { entry: pub, secrets } = extractSecrets(original);
        const restored = injectSecrets(pub, secrets);

        // The invariant, exactly and unconditionally: neither field the SDK would
        // serialise into `--mcp-config` argv still carries a credential. Stated as
        // "no non-empty string value", not `'x' in meta` — `extractSecrets` only
        // deletes a key it actually lifted a string out of, so an input carrying
        // `refreshToken: undefined` legitimately keeps the key. (That distinction
        // is itself why this is a value check: the first structural draft asserted
        // key absence and failed on seed 1's `{refreshToken: undefined}`.)
        const meta = (restored._meta ?? {}) as Record<string, unknown>;
        for (const field of ['refreshToken', 'clientSecret'] as const) {
          const survivor = meta[field];
          expect(typeof survivor === 'string' && survivor !== '', field).toBe(false);
        }

        // And they did not reappear anywhere else, expressed as "nothing else
        // moved": the restored object is the original minus those two fields. This
        // catches a leak into ANY slot — args, url, a new field — which the old
        // substring search only approximated, and it cannot collide with a
        // coincidental repeat of a generated string.
        const expectedMeta = original._meta ? { ...(original._meta as Record<string, unknown>) } : undefined;
        if (expectedMeta) {
          delete expectedMeta.refreshToken;
          delete expectedMeta.clientSecret;
        }
        expect(restored).toEqual(
          expectedMeta ? { ...original, _meta: expectedMeta } : original,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('every extracted secret value is replaced by the sentinel on disk', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const original = entry as Record<string, unknown>;
        const { entry: pub, secrets } = extractSecrets(original);

        // Slot by slot, rather than searching the serialised entry for the value.
        // An env slot that yielded a secret holds the sentinel and nothing else.
        for (const [name, value] of Object.entries(secrets.env ?? {})) {
          const written = (pub.env as Record<string, string>)[name];
          expect(written, name).toBe(SECRET_PLACEHOLDER);
          expect(written, name).not.toContain(value);
        }

        // A header slot holds prefix + sentinel, so strip the sentinel and what is
        // left — the scheme prefix, which is protocol and not secret — must not
        // contain the credential.
        for (const [name, value] of Object.entries(secrets.headers ?? {})) {
          const written = (pub.headers as Record<string, string>)[name];
          expect(written, name).toContain(SECRET_PLACEHOLDER);
          expect(written.split(SECRET_PLACEHOLDER).join(''), name).not.toContain(value);
        }

        // A _meta secret that was lifted is dropped outright, so its key is gone.
        const meta = (pub._meta ?? {}) as Record<string, unknown>;
        if (secrets.refreshToken !== undefined) expect('refreshToken' in meta).toBe(false);
        if (secrets.clientSecret !== undefined) expect('clientSecret' in meta).toBe(false);

        // Nothing but those slots changed: no secret was copied to a public field
        // on the way out. Same "nothing else moved" argument as above, and the
        // reason a substring search is no longer needed to cover unenumerated slots.
        const expectedPublic = { ...original };
        delete expectedPublic.env;
        delete expectedPublic.headers;
        delete expectedPublic._meta;
        const actualPublic = { ...pub };
        delete actualPublic.env;
        delete actualPublic.headers;
        delete actualPublic._meta;
        expect(actualPublic).toEqual(expectedPublic);
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

describe('hasUnresolvedSecrets / secretKeyForServer', () => {
  it('flags an entry whose sentinel survived injection', () => {
    // Nothing to inject: this is the shape that used to be mounted, sending
    // `${AIME_SECRET}` to the service as the credential.
    const stripped = extractSecrets(stdio()).entry;
    expect(hasUnresolvedSecrets(stripped)).toBe(true);
    expect(hasUnresolvedSecrets(injectSecrets(stripped, undefined))).toBe(true);
    expect(hasUnresolvedSecrets(injectSecrets(stripped, { env: {} }))).toBe(true);
  });

  it('flags a header whose sentinel survived, prefix and all', () => {
    const { entry, secrets } = extractSecrets(http());
    expect(hasUnresolvedSecrets(entry)).toBe(true);
    // and clears once the real credential is back
    expect(hasUnresolvedSecrets(injectSecrets(entry, secrets))).toBe(false);
  });

  it('clears once the stored secrets are injected back', () => {
    const { entry, secrets } = extractSecrets(stdio());
    expect(hasUnresolvedSecrets(injectSecrets(entry, secrets))).toBe(false);
  });

  it('is false for entries that never carried a secret', () => {
    expect(hasUnresolvedSecrets({ transport: 'streamable-http', url: 'https://x/mcp' })).toBe(false);
    expect(hasUnresolvedSecrets(stdio())).toBe(false); // real token inline, not a sentinel
    expect(hasUnresolvedSecrets({ env: { A: '' }, headers: {} })).toBe(false);
  });

  it('flags a partially resolved entry — one credential back, one missing', () => {
    const multi = {
      transport: 'stdio',
      env: { A_TOKEN: 'real-a', B_TOKEN: 'real-b' },
    };
    const { entry, secrets } = extractSecrets(multi);
    const partial = injectSecrets(entry, { env: { A_TOKEN: secrets.env!.A_TOKEN } });
    expect(hasUnresolvedSecrets(partial)).toBe(true);
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
