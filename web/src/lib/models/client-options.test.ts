import { describe, it, expect } from 'vitest';
import {
  buildModelOptions,
  buildTierOptions,
  buildTierSlotCandidates,
  findOption,
  groupOptions,
  isTierOption,
  tierFromOptionId,
  resolveSendRoute,
  defaultRoute,
  BUILTIN_GROUP,
  TIER_GROUP,
  type ConfiguredProviderLite,
} from './client-options';
import type { ProviderWithModels } from './effective-registry';

const BUILTINS = [
  { id: 'opus', label: 'Opus 4.7' },
  { id: 'sonnet', label: 'Sonnet 4.6' },
];

const openrouter: ConfiguredProviderLite = {
  id: 'or-1',
  presetId: 'openrouter',
  label: 'OpenRouter',
  enabled: true,
  models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }],
};

describe('tier options', () => {
  it('offers all four tiers, premium-first', () => {
    const tiers = buildTierOptions();
    expect(tiers.map((t) => t.tier)).toEqual(['stallion', 'smort', 'good', 'cheap']);
    expect(tiers.every((t) => t.kind === 'tier' && t.group === TIER_GROUP)).toBe(true);
  });

  it('round-trips a tier through its option id', () => {
    expect(isTierOption('tier:good')).toBe(true);
    expect(isTierOption('sonnet')).toBe(false);
    expect(tierFromOptionId('tier:smort')).toBe('smort');
    expect(tierFromOptionId('tier:nonsense')).toBeNull();
    expect(tierFromOptionId('sonnet')).toBeNull();
  });
});

describe('buildModelOptions', () => {
  it('lists tiers first, then built-ins', () => {
    const opts = buildModelOptions(BUILTINS, []);
    expect(opts[0].kind).toBe('tier');
    const builtin = opts.find((o) => o.id === 'sonnet')!;
    expect(builtin).toMatchObject({ group: BUILTIN_GROUP, kind: 'model', model: 'sonnet' });
    expect(builtin.providerConfig).toBeUndefined();
  });

  it('can omit tiers for a models-only picker', () => {
    const opts = buildModelOptions(BUILTINS, [], { includeTiers: false });
    expect(opts.some((o) => o.kind === 'tier')).toBe(false);
  });

  // The flood guard: a 345-model provider must not reach the dropdown.
  it('does NOT enumerate a provider catalog', () => {
    const many: ConfiguredProviderLite = {
      ...openrouter,
      models: Array.from({ length: 345 }, (_, i) => ({ id: `vendor/m-${i}`, label: `M${i}` })),
    };
    const opts = buildModelOptions(BUILTINS, [many]);
    expect(opts.filter((o) => o.group === 'OpenRouter')).toHaveLength(0);
    expect(opts).toHaveLength(4 + BUILTINS.length); // 4 tiers + built-ins only
  });

  it('surfaces a provider model that fills a tier slot', () => {
    const id = 'or-1:moonshotai/kimi-k2';
    const opts = buildModelOptions(BUILTINS, [openrouter], { tierModels: { smort: id } });
    const kimi = findOption(opts, id)!;
    expect(kimi).toMatchObject({ label: 'Kimi K2', group: 'OpenRouter', kind: 'model', model: 'moonshotai/kimi-k2' });
    expect(kimi.providerConfig).toEqual({
      providerId: 'or-1',
      // Per-model: a non-`anthropic/*` model on an aggregator must use the
      // openai-compat shim, not the Anthropic-format endpoint.
      transport: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('surfaces the current selection so a pinned model never vanishes', () => {
    const id = 'or-1:moonshotai/kimi-k2';
    const opts = buildModelOptions(BUILTINS, [openrouter], { includeModelIds: [id] });
    expect(findOption(opts, id)).toBeDefined();
  });

  it('skips disabled providers even when referenced', () => {
    const id = 'or-1:moonshotai/kimi-k2';
    const opts = buildModelOptions(BUILTINS, [{ ...openrouter, enabled: false }], { tierModels: { smort: id } });
    expect(findOption(opts, id)).toBeUndefined();
  });

  it('derives openai-compat transport and honours a base-URL override', () => {
    const local: ConfiguredProviderLite = {
      id: 'local-1',
      presetId: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:11434/v1',
      enabled: true,
      models: [{ id: 'llama3' }],
    };
    const opts = buildModelOptions(BUILTINS, [local], { includeModelIds: ['local-1:llama3'] });
    const o = findOption(opts, 'local-1:llama3')!;
    expect(o.label).toBe('llama3'); // falls back to id
    expect(o.providerConfig).toEqual({
      providerId: 'local-1',
      transport: 'openai-compat',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
  });
});

describe('groupOptions', () => {
  it('groups in insertion order with tiers first', () => {
    const id = 'or-1:moonshotai/kimi-k2';
    const groups = groupOptions(buildModelOptions(BUILTINS, [openrouter], { tierModels: { good: id } }));
    expect(groups.map((g) => g.group)).toEqual([TIER_GROUP, BUILTIN_GROUP, 'OpenRouter']);
  });
});

describe('resolveSendRoute', () => {
  const providers: ProviderWithModels[] = [
    {
      id: 'or-1',
      presetId: 'openrouter',
      label: 'OpenRouter',
      enabled: true,
      createdAt: 0,
      models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2', pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 } }],
    },
  ];

  it('returns null for no selection', () => {
    expect(resolveSendRoute(null, [], { capability: 'chat' })).toBeNull();
  });

  it('sends a pinned built-in as-is', () => {
    const sel = buildModelOptions(BUILTINS, []).find((o) => o.id === 'opus')!;
    expect(resolveSendRoute(sel, [], { capability: 'chat' })).toEqual({ model: 'opus', providerConfig: undefined });
  });

  it('resolves a tier selection to a built-in when no assignment exists', () => {
    const sel = buildTierOptions().find((o) => o.tier === 'good')!;
    expect(resolveSendRoute(sel, [], { capability: 'chat', hasAnthropicKey: true })).toEqual({ model: 'sonnet' });
  });

  it('resolves a tier selection onto a user model when assigned — the payoff', () => {
    const id = 'or-1:moonshotai/kimi-k2';
    const sel = buildTierOptions().find((o) => o.tier === 'smort')!;
    const route = resolveSendRoute(sel, providers, {
      capability: 'chat',
      tierModels: { smort: id },
      hasAnthropicKey: true,
    });
    expect(route?.model).toBe('moonshotai/kimi-k2');
    expect(route?.providerConfig?.providerId).toBe('or-1');
  });

  it('returns null when a tier cannot resolve, so the caller can fall back', () => {
    const sel = buildTierOptions().find((o) => o.tier === 'good')!;
    expect(resolveSendRoute(sel, [], { capability: 'chat', hasAnthropicKey: false })).toBeNull();
  });
});

describe('defaultRoute — where an unpinned turn actually goes', () => {
  const providers: ProviderWithModels[] = [
    {
      id: 'or-1',
      presetId: 'openrouter',
      label: 'OpenRouter',
      enabled: true,
      createdAt: 0,
      models: [
        {
          id: 'moonshotai/kimi-k2',
          label: 'Kimi K2',
          pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 },
        },
      ],
    },
  ];

  it('lands a BYOK-only user on their own provider, and says which tier', () => {
    const d = defaultRoute(providers, { capability: 'chat' })!;
    expect(d.tier).toBe('good'); // mid-range first — see DEFAULT_TIER_PREFERENCE
    expect(d.route.model).toBe('moonshotai/kimi-k2');
    expect(d.route.providerConfig?.providerId).toBe('or-1');
  });

  it('defers to the surface default when a built-in credential exists', () => {
    expect(defaultRoute(providers, { capability: 'chat', hasAnthropicKey: true })).toBeNull();
    expect(defaultRoute(providers, { capability: 'chat', hasBedrock: true })).toBeNull();
  });

  it('is null with no credentials at all, so the caller can fall back', () => {
    expect(defaultRoute([], { capability: 'chat' })).toBeNull();
    expect(defaultRoute([{ ...providers[0], enabled: false }], { capability: 'chat' })).toBeNull();
    expect(defaultRoute([{ ...providers[0], models: [] }], { capability: 'chat' })).toBeNull();
  });

  it('agrees with resolveSendRoute — the picker and the send path share it', () => {
    const opts = { capability: 'chat' as const };
    expect(resolveSendRoute(null, providers, opts)).toEqual(defaultRoute(providers, opts)!.route);
  });

  it('falls through the tier preference when the first tier is unpopulated', () => {
    // Priced into 'stallion' only, so 'good' and 'smort' cannot resolve.
    const pricey: ProviderWithModels[] = [
      {
        ...providers[0],
        models: [{ id: 'x/big', label: 'Big', pricing: { inputPer1kUsd: 0.1, outputPer1kUsd: 0.2 } }],
      },
    ];
    const d = defaultRoute(pricey, { capability: 'chat' })!;
    expect(d.tier).toBe('stallion');
    expect(d.route.model).toBe('x/big');
  });
});

describe('buildTierSlotCandidates', () => {
  it('DOES span the full catalog (it is search-backed, unlike the dropdown)', () => {
    const many: ProviderWithModels = {
      id: 'or-1',
      presetId: 'openrouter',
      label: 'OpenRouter',
      enabled: true,
      createdAt: 0,
      models: Array.from({ length: 345 }, (_, i) => ({
        id: `vendor/m-${i}`,
        label: `M${i}`,
        pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 },
      })),
    };
    const cands = buildTierSlotCandidates(BUILTINS, [many]);
    expect(cands).toHaveLength(BUILTINS.length + 345);
    expect(cands.at(-1)).toMatchObject({ group: 'OpenRouter', outputPer1kUsd: 0.002 });
  });
});
