import { describe, it, expect } from 'vitest';
import { filledTiers } from './tier-availability';
import { resolveClientRoute, type ProviderWithModels } from './effective-registry';
import { createDefaultRegistry } from './registry';
import { TIER_ORDER, type Capability } from './types';

const OPENROUTER_CHEAP: ProviderWithModels = {
  id: 'or-1',
  presetId: 'openrouter',
  label: 'OpenRouter',
  enabled: true,
  createdAt: 0,
  // $0.002/1k out → the "cheap" band.
  models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2', pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 } }],
};

describe('filledTiers', () => {
  it('an OpenRouter-only user has exactly the tiers their models fall in', () => {
    const filled = filledTiers('chat', [OPENROUTER_CHEAP], {});
    expect([...filled]).toEqual(['cheap']);
    expect(filled.has('stallion')).toBe(false);
    expect(filled.has('smort')).toBe(false);
  });

  it('an assignment in the tier grid fills that tier', () => {
    const filled = filledTiers('chat', [OPENROUTER_CHEAP], { tierModels: { smort: 'or-1:moonshotai/kimi-k2' } });
    expect(filled.has('smort')).toBe(true);
  });

  it('with the built-ins reachable, chat has no Stallion but code does', () => {
    expect(filledTiers('chat', [], { hasAnthropicKey: true }).has('stallion')).toBe(false);
    expect(filledTiers('code', [], { hasAnthropicKey: true }).has('stallion')).toBe(true);
  });

  it('nothing is filled with no credentials and no providers', () => {
    expect(filledTiers('chat', [], {}).size).toBe(0);
  });

  it('agrees with the send path: a filled tier always resolves', () => {
    const cases: Array<[Capability, ProviderWithModels[], { hasAnthropicKey?: boolean }]> = [
      ['chat', [OPENROUTER_CHEAP], {}],
      ['code', [OPENROUTER_CHEAP], { hasAnthropicKey: true }],
      ['chat', [], { hasAnthropicKey: true }],
    ];
    for (const [capability, providers, creds] of cases) {
      const filled = filledTiers(capability, providers, creds);
      for (const tier of TIER_ORDER) {
        if (!filled.has(tier)) continue;
        expect(
          resolveClientRoute(capability, tier, providers, { base: createDefaultRegistry(), ...creds }),
          `${capability}/${tier}`,
        ).not.toBeNull();
      }
    }
  });
});
