import { describe, it, expect } from 'vitest';
import {
  inferTier,
  kindForTransport,
  buildEffectiveRegistry,
  resolveClientRoute,
  execConfigFor,
  userModelId,
  TIER_PRICE_CEILINGS,
  type ProviderWithModels,
} from './effective-registry';
import { createDefaultRegistry, resolveRoute } from './registry';
import type { ScannedModel } from './providers';
import type { Tier } from './types';

const priced = (out: number) => ({ inputPer1kUsd: out / 3, outputPer1kUsd: out });

const provider = (over: Partial<ProviderWithModels> = {}): ProviderWithModels => ({
  id: 'or-1',
  presetId: 'openrouter',
  label: 'OpenRouter',
  enabled: true,
  createdAt: 0,
  models: [],
  ...over,
});

describe('inferTier — price bands anchored to the Claude ladder', () => {
  it('places each built-in Claude price in its own tier', () => {
    expect(inferTier(priced(0.005))).toBe('cheap'); // haiku
    expect(inferTier(priced(0.015))).toBe('good'); // sonnet
    expect(inferTier(priced(0.025))).toBe('smort'); // opus
    expect(inferTier(priced(0.05))).toBe('stallion'); // fable
  });

  it('handles the real OpenRouter price extremes', () => {
    expect(inferTier(priced(0.00003))).toBe('cheap'); // ling-2.6-flash
    expect(inferTier(priced(0.6))).toBe('stallion'); // o1-pro
  });

  it('returns null when there is no usable price signal', () => {
    // Free/local: price is meaningless (a 3B and a 70B are both $0), so the
    // user must choose rather than us guessing.
    expect(inferTier(priced(0))).toBeNull();
    expect(inferTier(undefined)).toBeNull();
    expect(inferTier({ inputPer1kUsd: 1, outputPer1kUsd: Number.NaN })).toBeNull();
  });

  it('has ascending, exhaustive bands', () => {
    const ceilings = TIER_PRICE_CEILINGS.map((b) => b.maxOutputPer1kUsd);
    expect(ceilings).toEqual([...ceilings].sort((a, b) => a - b));
    expect(ceilings.at(-1)).toBe(Infinity);
  });
});

describe('kindForTransport', () => {
  it('maps transports to registry provider kinds', () => {
    expect(kindForTransport('native-fal', 'fal')).toBe('fal');
    expect(kindForTransport('openai-compat', 'local')).toBe('local');
    expect(kindForTransport('openai-compat', 'openai')).toBe('openai');
    expect(kindForTransport('anthropic-native', 'anthropic')).toBe('anthropic');
    // a user-added anthropic-native provider is reached via a compat base URL
    expect(kindForTransport('anthropic-native', 'openrouter')).toBe('anthropic-compat');
  });
});

describe('buildEffectiveRegistry', () => {
  const base = createDefaultRegistry();

  it('leaves the base registry untouched with no providers', () => {
    const reg = buildEffectiveRegistry(base, []);
    expect(reg.models.map((m) => m.id)).toEqual(base.models.map((m) => m.id));
    // and does not mutate the base routing arrays
    expect(reg.routing.chat?.good).not.toBe(base.routing.chat?.good);
  });

  it('adds an enabled provider and routes its model by inferred tier', () => {
    const reg = buildEffectiveRegistry(base, [
      provider({ models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2', pricing: priced(0.025) }] }),
    ]);
    const id = userModelId('or-1', 'moonshotai/kimi-k2');
    expect(reg.providers.find((p) => p.id === 'or-1')?.kind).toBe('anthropic-compat');

    const model = reg.models.find((m) => m.id === id)!;
    expect(model.driverModel).toBe('moonshotai/kimi-k2');
    expect(model.agentCapable).toBe(true);
    // priced at opus level → smort, appended AFTER the existing built-in
    // candidates (which already include a same-tier fallback), so a user model
    // never silently displaces a built-in primary.
    expect(reg.routing.chat?.smort?.[0]).toBe('claude-opus');
    expect(reg.routing.chat?.smort?.at(-1)).toBe(id);
    expect(reg.routing.code?.smort).toContain(id);
  });

  it('skips disabled providers and fal (capability-only) providers', () => {
    const reg = buildEffectiveRegistry(base, [
      provider({ id: 'off', enabled: false, models: [{ id: 'a', label: 'a', pricing: priced(0.01) }] }),
      provider({ id: 'fal-1', presetId: 'fal', label: 'Fal', models: [{ id: 'flux', label: 'flux', pricing: priced(0.01) }] }),
    ]);
    expect(reg.providers.find((p) => p.id === 'off')).toBeUndefined();
    expect(reg.providers.find((p) => p.id === 'fal-1')).toBeUndefined();
    expect(reg.models.some((m) => m.id.startsWith('fal-1:'))).toBe(false);
  });

  it('does not route an unpriced (local) model, but still registers it', () => {
    const reg = buildEffectiveRegistry(base, [
      provider({ id: 'local-1', presetId: 'local', label: 'Local', models: [{ id: 'llama3', label: 'llama3' }] }),
    ]);
    const id = userModelId('local-1', 'llama3');
    expect(reg.models.find((m) => m.id === id)).toBeDefined();
    // reachable only via an explicit tier assignment
    expect(Object.values(reg.routing.chat ?? {}).flat()).not.toContain(id);
  });

  it('an explicit tier assignment promotes a model to the front of that tier', () => {
    const id = userModelId('local-1', 'llama3');
    const reg = buildEffectiveRegistry(
      base,
      [provider({ id: 'local-1', presetId: 'local', label: 'Local', models: [{ id: 'llama3', label: 'llama3' }] })],
      { good: id },
    );
    expect(reg.routing.chat?.good?.[0]).toBe(id);
    expect(reg.routing.chat?.good).toContain('claude-sonnet'); // built-in kept as fallback
  });

  it('ignores a stale assignment whose provider is gone', () => {
    const reg = buildEffectiveRegistry(base, [], { good: 'removed-provider:some-model' });
    expect(reg.routing.chat?.good).toEqual(base.routing.chat?.good);
  });

  it('honours scan-declared capabilities instead of defaulting to both', () => {
    const reg = buildEffectiveRegistry(base, [
      provider({ models: [{ id: 'chat-only', label: 'Chat Only', capabilities: ['chat'], pricing: priced(0.01) }] }),
    ]);
    const id = userModelId('or-1', 'chat-only');
    expect(reg.routing.chat?.good).toContain(id);
    expect(reg.routing.code?.good ?? []).not.toContain(id);
  });

  // Regression for the flood that a single-model fixture hid: OpenRouter really
  // returns ~345 models spanning a 20,000x price range.
  it('handles a realistic 345-model scan, spreading it across all four tiers', () => {
    const many: ScannedModel[] = Array.from({ length: 345 }, (_, i) => ({
      id: `vendor/model-${i}`,
      label: `Model ${i}`,
      // sweep 0.00003 → 0.6 so every band is populated
      pricing: priced(0.00003 + (i / 344) * 0.6),
    }));
    const reg = buildEffectiveRegistry(base, [provider({ models: many })]);
    expect(reg.models).toHaveLength(base.models.length + 345);

    const tiers: Tier[] = ['cheap', 'good', 'smort', 'stallion'];
    for (const t of tiers) {
      expect((reg.routing.chat?.[t] ?? []).length).toBeGreaterThan(1);
    }
    // built-ins remain primary in every tier despite 345 newcomers
    expect(reg.routing.chat?.good?.[0]).toBe('claude-sonnet');
    expect(reg.routing.chat?.cheap?.[0]).toBe('claude-haiku');
  });
});

describe('execConfigFor', () => {
  const base = createDefaultRegistry();

  it('returns undefined for a built-in model', () => {
    const model = base.models.find((m) => m.id === 'claude-opus')!;
    expect(execConfigFor(model, [])).toBeUndefined();
  });

  it('derives base URL from the preset, preferring an override', () => {
    const providers = [provider({ baseUrl: 'https://gw.internal/v1' })];
    const reg = buildEffectiveRegistry(base, [
      provider({ baseUrl: 'https://gw.internal/v1', models: [{ id: 'm', label: 'M', pricing: priced(0.01) }] }),
    ]);
    const model = reg.models.find((m) => m.id === userModelId('or-1', 'm'))!;
    expect(execConfigFor(model, providers)?.baseUrl).toBe('https://gw.internal/v1');
    expect(execConfigFor(model, providers)?.providerId).toBe('or-1');
  });

  /**
   * The transport is per MODEL, not per provider. This test previously asserted
   * that a non-Anthropic OpenRouter model got 'anthropic-native' — encoding the
   * bug that produced "There's an issue with the selected model
   * (google/gemini-3.6-flash)": OpenRouter's /api/v1/messages serves `anthropic/*`
   * only, so everything else has to go through the openai-compat shim.
   */
  it('sends an aggregator\'s own-vendor model natively and the rest via the shim', () => {
    const models = [
      { id: 'anthropic/claude-x', label: 'Claude X', pricing: priced(0.01) },
      { id: 'google/gemini-3.6-flash', label: 'Gemini', pricing: priced(0.01) },
      { id: 'moonshotai/kimi-k3', label: 'Kimi', pricing: priced(0.01) },
    ];
    const providers = [provider({ models })];
    const reg = buildEffectiveRegistry(base, [provider({ models })]);
    const transportOf = (id: string) =>
      execConfigFor(reg.models.find((m) => m.id === userModelId('or-1', id))!, providers)?.transport;

    expect(transportOf('anthropic/claude-x')).toBe('anthropic-native');
    expect(transportOf('google/gemini-3.6-flash')).toBe('openai-compat');
    expect(transportOf('moonshotai/kimi-k3')).toBe('openai-compat');
  });
});

describe('resolveClientRoute', () => {
  const base = createDefaultRegistry();

  it('resolves a built-in tier to a bare model with no providerConfig', () => {
    const route = resolveClientRoute('chat', 'good', [], { base, hasAnthropicKey: true });
    expect(route).toEqual({ model: 'sonnet' });
  });

  it('returns null when no provider is available', () => {
    expect(resolveClientRoute('chat', 'good', [], { base })).toBeNull();
  });

  it('reaches a user model via an explicit tier assignment — the DR-13 payoff', () => {
    const providers = [
      provider({ models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2', pricing: priced(0.002) }] }),
    ];
    const id = userModelId('or-1', 'moonshotai/kimi-k2');
    const route = resolveClientRoute('chat', 'smort', providers, {
      base,
      tierAssignments: { smort: id },
      hasAnthropicKey: true,
    });
    expect(route).toEqual({
      model: 'moonshotai/kimi-k2',
      // Kimi is not an `anthropic/*` model, so it routes via the openai-compat
      // shim rather than OpenRouter's Anthropic endpoint.
      providerConfig: { providerId: 'or-1', transport: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1' },
    });
  });

  it('falls back to a user model when the built-in provider has no key', () => {
    const providers = [provider({ models: [{ id: 'm', label: 'M', pricing: priced(0.015) }] }) ];
    const route = resolveClientRoute('chat', 'good', providers, { base, hasAnthropicKey: false });
    // built-ins unavailable → the user model in that tier wins
    expect(route?.model).toBe('m');
    expect(route?.providerConfig?.providerId).toBe('or-1');
  });

  it('tumbles down tiers like the base resolver', () => {
    // chat has no stallion tier → tumbles to smort (opus)
    const route = resolveClientRoute('chat', 'stallion', [], { base, hasAnthropicKey: true });
    expect(route).toEqual({ model: 'opus' });
  });
});

// The effective registry must stay compatible with the plain resolver.
describe('integration with resolveRoute', () => {
  it('a tier request resolves through the merged registry', () => {
    const base = createDefaultRegistry();
    const id = userModelId('or-1', 'k2');
    const reg = buildEffectiveRegistry(
      base,
      [provider({ models: [{ id: 'k2', label: 'K2', pricing: priced(0.03) }] })],
      { smort: id },
    );
    const r = resolveRoute(reg, 'code', 'smort', () => true);
    expect(r?.model.id).toBe(id);
    expect(r?.provider.kind).toBe('anthropic-compat');
    expect(r?.degraded).toBe(false); // promoted to primary
  });
});
