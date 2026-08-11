import { describe, it, expect } from 'vitest';
import { dedupeProviders, duplicateProviderCount } from './dedupe-providers';

/**
 * Thirteen OpenRouter rows on one install, each with its own key in the
 * keychain, because every save minted a fresh uuid before
 * `providerIdForPreset` learned to reuse one. That mint is fixed; this is the
 * repair for data written before it, so the winning row's ID matters — it is
 * the credential's key, and picking wrong silently drops the user's API key.
 */
const row = (over: Partial<Parameters<typeof dedupeProviders>[0][number]> = {}) => ({
  id: 'id-1',
  presetId: 'openrouter',
  models: [],
  createdAt: 1,
  ...over,
});

describe('dedupeProviders', () => {
  it('collapses repeated rows for one preset', () => {
    const out = dedupeProviders([
      row({ id: 'a', createdAt: 1 }),
      row({ id: 'b', createdAt: 2 }),
      row({ id: 'c', createdAt: 3 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps the row that actually has credentials', () => {
    const out = dedupeProviders([
      row({ id: 'newest-but-empty', createdAt: 99 }),
      row({ id: 'has-key', createdAt: 1, hasCredentials: true }),
    ]);
    expect(out[0].id, 'the surviving row has no key in the keychain').toBe('has-key');
  });

  it('prefers the newest among rows that all have credentials', () => {
    const out = dedupeProviders([
      row({ id: 'old', createdAt: 1, hasCredentials: true }),
      row({ id: 'new', createdAt: 5, hasCredentials: true }),
    ]);
    expect(out[0].id).toBe('new');
  });

  it('prefers the newest among rows that all lack credentials', () => {
    const out = dedupeProviders([row({ id: 'old', createdAt: 1 }), row({ id: 'new', createdAt: 5 })]);
    expect(out[0].id).toBe('new');
  });

  it('leaves different presets alone', () => {
    const out = dedupeProviders([
      row({ id: 'a', presetId: 'openrouter' }),
      row({ id: 'b', presetId: 'anthropic' }),
      row({ id: 'c', presetId: 'groq' }),
    ]);
    expect(out).toHaveLength(3);
  });

  it('keeps the original ordering of presets', () => {
    const out = dedupeProviders([
      row({ id: 'a', presetId: 'groq' }),
      row({ id: 'b', presetId: 'openrouter' }),
      row({ id: 'c', presetId: 'groq' }),
    ]);
    expect(out.map((p) => p.presetId)).toEqual(['groq', 'openrouter']);
  });

  /*
   * Each row was scanned separately, so enabling a model on one of them is a
   * choice the user made once and should not be asked to make again.
   */
  it('unions the scanned models across the collapsed rows', () => {
    const out = dedupeProviders([
      row({ id: 'a', createdAt: 1, models: [{ id: 'm1' }, { id: 'm2' }] as never }),
      row({ id: 'b', createdAt: 2, models: [{ id: 'm2' }, { id: 'm3' }] as never }),
    ]);
    expect(out[0].models!.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('is idempotent, since it runs on every load', () => {
    const once = dedupeProviders([row({ id: 'a', createdAt: 1 }), row({ id: 'b', createdAt: 2 })]);
    expect(dedupeProviders(once)).toEqual(once);
  });

  it('leaves an already-clean list untouched', () => {
    const clean = [row({ id: 'a', presetId: 'openrouter' }), row({ id: 'b', presetId: 'groq' })];
    expect(dedupeProviders(clean)).toEqual(clean);
  });

  it.each([
    ['an empty list', []],
    ['a non-array', null],
    ['rows with no presetId', [{ id: 'a' }]],
    ['rows with no id', [{ presetId: 'openrouter' }]],
  ])('survives %s', (_label, input) => {
    expect(() => dedupeProviders(input as never)).not.toThrow();
  });
});

describe('duplicateProviderCount', () => {
  it('counts what would be removed', () => {
    expect(
      duplicateProviderCount([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]),
    ).toBe(2);
  });

  it('is zero for a clean list, so the repair stays silent', () => {
    expect(duplicateProviderCount([row({ id: 'a', presetId: 'openrouter' })])).toBe(0);
  });

  /* The reported case: thirteen rows for one preset become one. */
  it('reduces thirteen OpenRouter rows to a single entry', () => {
    const thirteen = Array.from({ length: 13 }, (_, i) =>
      row({ id: `or-${i}`, createdAt: i, hasCredentials: i === 4 }),
    );
    expect(duplicateProviderCount(thirteen)).toBe(12);
    expect(dedupeProviders(thirteen)[0].id).toBe('or-4');
  });
});
