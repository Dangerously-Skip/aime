import { describe, it, expect } from 'vitest';
import {
  buildManifest,
  parseManifest,
  resolveFromManifest,
  stripSecrets,
  manifestKey,
  emptyManifest,
  MANIFEST_VERSION,
} from './execution-manifest';

/**
 * The tier grid's decision, made readable by a process that has no request.
 *
 * The widget scheduler ticks inside the Next server so a due widget refreshes
 * "with no window at all" — and therefore had no access to the user's provider
 * configuration. `refresh-service.ts` fell back to a hardcoded `'haiku'` and an
 * Anthropic-only key, so on an OpenRouter account every scheduled refresh failed
 * silently, once per tick.
 */

const NOW = '2026-08-22T00:00:00.000Z';

describe('building a manifest', () => {
  it('keys routes by capability and tier', () => {
    const m = buildManifest([{ capability: 'chat', model: 'sonnet' }], NOW);
    expect(m.routes[manifestKey('chat')]).toEqual({ model: 'sonnet', providerConfig: undefined });
  });

  it('drops a slot with no resolved model', () => {
    /*
     * An unconfigured slot is not a route. Writing it with an empty model would
     * hand the reader something that looks resolved and is not — which is how a
     * caller ends up "resolving" to '' and sending it to a provider.
     */
    const m = buildManifest(
      [
        { capability: 'chat', model: 'sonnet' },
        { capability: 'code', model: null },
        { capability: 'chat', model: '   ' },
      ],
      NOW,
    );
    expect(Object.keys(m.routes)).toEqual(['chat']);
  });

  it('carries the provider config the server needs to execute', () => {
    const m = buildManifest(
      [{
        capability: 'code', model: 'deepseek/deepseek-v4-pro',
        providerConfig: { providerId: 'openrouter-1', baseUrl: 'https://openrouter.ai/api/v1' },
      }],
      NOW,
    );
    expect(m.routes['code'].providerConfig).toEqual({
      providerId: 'openrouter-1',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });
});

describe('no secrets reach the file', () => {
  /*
   * This manifest is PLAIN JSON on disk, unlike the credential store, and the
   * route that writes it is unauthenticated on loopback. A provider config
   * arriving with a key — because some future caller built it from a fuller
   * object — must not be written through.
   */
  it.each(['apiKey', 'api_key', 'token', 'secret', 'password', 'credential'])(
    'strips %s',
    (field) => {
      const out = stripSecrets({ providerId: 'p1', [field]: 'sk-live-abcdef' }) as unknown as Record<string, unknown>;
      expect(out.providerId).toBe('p1');
      expect(JSON.stringify(out)).not.toContain('sk-live-abcdef');
    },
  );

  it('strips case-variant and embedded spellings', () => {
    const out = stripSecrets({ providerId: 'p1', ANTHROPIC_API_KEY: 'sk-x', userToken: 'tok' });
    expect(JSON.stringify(out)).not.toContain('sk-x');
    expect(JSON.stringify(out)).not.toContain('tok');
  });

  it('drops nested objects entirely, so nothing hides one level down', () => {
    const out = stripSecrets({ providerId: 'p1', settings: { apiKey: 'sk-hidden' } });
    expect(JSON.stringify(out)).not.toContain('sk-hidden');
  });

  it('refuses a config with no providerId — it could not be executed anyway', () => {
    expect(stripSecrets({ baseUrl: 'https://x' })).toBeUndefined();
    expect(stripSecrets(null)).toBeUndefined();
    expect(stripSecrets('nonsense')).toBeUndefined();
  });

  it('a built manifest never contains a key, even if one is passed in', () => {
    const m = buildManifest(
      [{ capability: 'chat', model: 'sonnet', providerConfig: { providerId: 'p', apiKey: 'sk-leak' } }],
      NOW,
    );
    expect(JSON.stringify(m)).not.toContain('sk-leak');
  });
});

describe('parsing a file we did not write', () => {
  /*
   * Validated rather than cast: the writing route is unauthenticated on
   * loopback, and a hostile entry would otherwise choose the model an unattended
   * agent runs on. Anything unusable parses to null and the caller skips.
   */
  it('round-trips a manifest it built', () => {
    const m = buildManifest([{ capability: 'chat', model: 'sonnet' }], NOW);
    expect(parseManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it.each([null, undefined, 42, 'text', [], {}, { version: 2, routes: {} }, { version: 1 }])(
    'rejects %p',
    (bad) => {
      expect(parseManifest(bad)).toBeNull();
    },
  );

  it('drops individual malformed routes without discarding the file', () => {
    const parsed = parseManifest({
      version: MANIFEST_VERSION,
      updatedAt: NOW,
      routes: {
        chat: { model: 'sonnet' },
        'bad key with spaces': { model: 'x' },
        code: { model: 42 },
        image: null,
      },
    });
    expect(Object.keys(parsed!.routes)).toEqual(['chat']);
  });

  it('strips secrets on the way IN as well as out', () => {
    // A file edited by hand, or written before this rule existed.
    const parsed = parseManifest({
      version: MANIFEST_VERSION,
      updatedAt: NOW,
      routes: { chat: { model: 'sonnet', providerConfig: { providerId: 'p', apiKey: 'sk-old' } } },
    });
    expect(JSON.stringify(parsed)).not.toContain('sk-old');
  });
});

describe('resolving, where null means DO NOTHING', () => {
  const m = buildManifest([{ capability: 'chat', model: 'sonnet' }], NOW);

  it('returns the configured route', () => {
    expect(resolveFromManifest(m, 'chat')?.model).toBe('sonnet');
  });

  it('returns null for a slot the user never configured', () => {
    /*
     * The load-bearing behaviour. A default here IS the hardcoded 'haiku' this
     * whole file exists to delete: it fails once per tick, invisibly, for
     * everyone not on the vendor it guessed.
     */
    expect(resolveFromManifest(m, 'code')).toBeNull();
  });

  it('returns null when there is no manifest at all', () => {
    expect(resolveFromManifest(null, 'chat')).toBeNull();
  });

  it('an empty manifest resolves nothing', () => {
    expect(resolveFromManifest(emptyManifest(NOW), 'chat')).toBeNull();
  });
});
