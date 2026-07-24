/**
 * Model registry: lookups and (capability, tier) → model resolution with
 * tumbling. Pure and provider-agnostic — availability is injected so the
 * resolver stays testable and free of settings/env coupling.
 */
import {
  type Capability,
  type Model,
  type ModelProvider,
  type ModelRegistry,
  type ResolvedRoute,
  type ResolvedRouteWithSettings,
  type RouteSettings,
  type RouteSlot,
  type Tier,
  TIER_ORDER,
} from './types';

export function getModel(registry: ModelRegistry, id: string): Model | undefined {
  return registry.models.find((m) => m.id === id);
}

export function getProvider(registry: ModelRegistry, id: string): ModelProvider | undefined {
  return registry.providers.find((p) => p.id === id);
}

export function modelsForCapability(registry: ModelRegistry, capability: Capability): Model[] {
  return registry.models.filter((m) => m.capabilities.includes(capability));
}

/** Predicate: is this provider usable right now (has credentials)? */
export type AvailabilityFn = (provider: ModelProvider) => boolean;

/** Candidate model ids for a (capability, tier), primary first. */
function candidatesFor(registry: ModelRegistry, capability: Capability, tier: Tier): string[] {
  return registry.routing[capability]?.[tier] ?? [];
}

/**
 * Resolve a (capability, tier) request to a concrete model on an available
 * provider.
 *
 * 1. Walk the candidate list for the requested tier; return the first whose
 *    provider is available. A non-primary pick sets `degraded`.
 * 2. If none, tier-tumble downward (smort → good → cheap) and retry. Any
 *    lower-tier result is `degraded`. Set `allowTierDegrade: false` to disable.
 * 3. Return null when nothing resolves.
 */
export function resolveRoute(
  registry: ModelRegistry,
  capability: Capability,
  tier: Tier,
  isAvailable: AvailabilityFn,
  opts: { allowTierDegrade?: boolean; candidateFilter?: (model: Model) => boolean } = {},
): ResolvedRoute | null {
  const { allowTierDegrade = true, candidateFilter } = opts;

  const startIdx = TIER_ORDER.indexOf(tier);
  // Requested tier first, then progressively cheaper tiers.
  const tiersToTry = allowTierDegrade ? TIER_ORDER.slice(startIdx) : [tier];

  for (const [tierOffset, candidateTier] of tiersToTry.entries()) {
    const candidates = candidatesFor(registry, capability, candidateTier);
    for (const [candidateIdx, modelId] of candidates.entries()) {
      const model = getModel(registry, modelId);
      if (!model) continue;
      // A filtered-out candidate (e.g. over a cost ceiling) is skipped like an
      // unavailable one — a later, cheaper pick still counts as degraded.
      if (candidateFilter && !candidateFilter(model)) continue;
      const provider = getProvider(registry, model.providerId);
      if (!provider || !isAvailable(provider)) continue;
      return {
        model,
        provider,
        capability,
        tier: candidateTier,
        degraded: tierOffset > 0 || candidateIdx > 0,
      };
    }
  }
  return null;
}

/** Map warmth (0..1) to an Anthropic/OpenAI temperature, clamped to [0, 1]. */
export function warmthToTemperature(warmth: number): number {
  return Math.max(0, Math.min(1, warmth));
}

const slotKey = (capability: Capability, tier: Tier): string => `${capability}:${tier}`;

/**
 * Resolve a route under a `RouteSettings` policy — the full "cost compaction"
 * lever set on top of the base resolver:
 *
 * 1. `maxTier` clamps a too-premium request down before resolution.
 * 2. `costCeilingPer1kUsd` filters out candidates priced above the ceiling.
 * 3. `tumbleChains` replaces the default downward tumble with an explicit slot
 *    chain for the (capability, effectiveTier) primary.
 * 4. `warmth` is turned into a temperature returned alongside the route.
 *
 * A clamp or non-primary pick marks the route `degraded`. Returns null when
 * nothing resolves.
 */
export function resolveWithSettings(
  registry: ModelRegistry,
  capability: Capability,
  tier: Tier,
  isAvailable: AvailabilityFn,
  settings: RouteSettings = {},
): ResolvedRouteWithSettings | null {
  // 1. maxTier clamp. TIER_ORDER is premium→cheap, so a more-premium request
  //    has a LOWER index than its cap.
  let effectiveTier = tier;
  if (settings.maxTier) {
    const reqIdx = TIER_ORDER.indexOf(tier);
    const capIdx = TIER_ORDER.indexOf(settings.maxTier);
    if (reqIdx >= 0 && capIdx >= 0 && reqIdx < capIdx) effectiveTier = settings.maxTier;
  }

  // 2. cost ceiling filter.
  const ceiling = settings.costCeilingPer1kUsd;
  const candidateFilter =
    ceiling != null ? (m: Model) => m.pricing == null || m.pricing.outputPer1kUsd <= ceiling : undefined;

  // 3. explicit tumble chain (if any) for the primary slot.
  const chain = settings.tumbleChains?.[slotKey(capability, effectiveTier)];
  let route: ResolvedRoute | null = null;
  if (chain && chain.length) {
    const slots: RouteSlot[] = [{ capability, tier: effectiveTier }, ...chain];
    for (const [i, slot] of slots.entries()) {
      const r = resolveRoute(registry, slot.capability, slot.tier, isAvailable, {
        allowTierDegrade: false,
        candidateFilter,
      });
      if (r) {
        route = i > 0 ? { ...r, degraded: true } : r;
        break;
      }
    }
  } else {
    route = resolveRoute(registry, capability, effectiveTier, isAvailable, { candidateFilter });
  }

  if (!route) return null;
  // A clamp that actually lowered the tier is itself a degrade signal.
  if (effectiveTier !== tier) route = { ...route, degraded: true };

  const out: ResolvedRouteWithSettings = { route };
  if (settings.warmth != null) out.temperature = warmthToTemperature(settings.warmth);
  return out;
}

// ── Default registry ──────────────────────────────────────────────────────
// Reproduces today's behaviour exactly: Claude opus/sonnet/haiku for the
// agent surfaces, reachable via the Anthropic API or Bedrock. A no-behaviour-
// change drop-in; user-added providers/models layer on top in P1.2.

const ANTHROPIC_PROVIDER: ModelProvider = {
  id: 'anthropic',
  label: 'Anthropic API',
  kind: 'anthropic',
  credentialEnv: ['ANTHROPIC_API_KEY'],
};

const BEDROCK_PROVIDER: ModelProvider = {
  id: 'bedrock',
  label: 'AWS Bedrock',
  kind: 'bedrock',
  credentialEnv: ['AWS_REGION', 'AWS_DEFAULT_REGION'],
};

/**
 * Claude models. opus/sonnet/haiku use the SDK short names the CLI resolves;
 * Fable uses its full model id (the short `fable` alias isn't guaranteed).
 * Pricing is per-1k USD from the current model reference (Fable $10/$50,
 * Opus 4.8 $5/$25, Sonnet 5 $3/$15, Haiku 4.5 $1/$5).
 */
const CLAUDE_MODELS: Model[] = [
  {
    id: 'claude-fable',
    providerId: 'anthropic',
    label: 'Claude Fable',
    capabilities: ['chat', 'code'],
    driverModel: 'claude-fable-5',
    agentCapable: true,
    contextWindow: 1_000_000,
    pricing: { inputPer1kUsd: 0.010, outputPer1kUsd: 0.050 },
  },
  {
    id: 'claude-opus',
    providerId: 'anthropic',
    label: 'Claude Opus',
    capabilities: ['chat', 'code'],
    driverModel: 'opus',
    agentCapable: true,
    contextWindow: 1_000_000,
    pricing: { inputPer1kUsd: 0.005, outputPer1kUsd: 0.025 },
  },
  {
    id: 'claude-sonnet',
    providerId: 'anthropic',
    label: 'Claude Sonnet',
    capabilities: ['chat', 'code'],
    driverModel: 'sonnet',
    agentCapable: true,
    contextWindow: 1_000_000,
    pricing: { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
  },
  {
    id: 'claude-haiku',
    providerId: 'anthropic',
    label: 'Claude Haiku',
    capabilities: ['chat', 'code'],
    driverModel: 'haiku',
    agentCapable: true,
    contextWindow: 200_000,
    pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.005 },
  },
];

/** Build a fresh copy of the default registry (never share mutable state). */
export function createDefaultRegistry(): ModelRegistry {
  return {
    providers: [{ ...ANTHROPIC_PROVIDER }, { ...BEDROCK_PROVIDER }],
    models: CLAUDE_MODELS.map((m) => ({ ...m })),
    routing: {
      // chat has no stallion tier — a stallion chat request tumbles to smort.
      chat: {
        smort: ['claude-opus', 'claude-sonnet'],
        good: ['claude-sonnet', 'claude-haiku'],
        cheap: ['claude-haiku'],
      },
      // code adds stallion (Fable) as the premium coding tier.
      code: {
        stallion: ['claude-fable', 'claude-opus'],
        smort: ['claude-opus', 'claude-sonnet'],
        good: ['claude-sonnet', 'claude-haiku'],
        cheap: ['claude-haiku'],
      },
    },
  };
}

/**
 * Availability from process env: a provider is usable if any of its
 * `credentialEnv` vars is set. Bedrock also needs a credential source, but the
 * chat route/provider already gate that; here presence of a region is enough
 * to offer it. User-set keys (settings) are layered in by the store in P1.2.
 */
export function envAvailability(provider: ModelProvider): boolean {
  if (!provider.credentialEnv || provider.credentialEnv.length === 0) return true;
  return provider.credentialEnv.some((name) => !!process.env[name]);
}
