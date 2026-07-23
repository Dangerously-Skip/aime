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
  opts: { allowTierDegrade?: boolean } = {},
): ResolvedRoute | null {
  const { allowTierDegrade = true } = opts;

  const startIdx = TIER_ORDER.indexOf(tier);
  // Requested tier first, then progressively cheaper tiers.
  const tiersToTry = allowTierDegrade ? TIER_ORDER.slice(startIdx) : [tier];

  for (const [tierOffset, candidateTier] of tiersToTry.entries()) {
    const candidates = candidatesFor(registry, capability, candidateTier);
    for (const [candidateIdx, modelId] of candidates.entries()) {
      const model = getModel(registry, modelId);
      if (!model) continue;
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

/** Claude models keyed to the SDK short names the provider already passes. */
const CLAUDE_MODELS: Model[] = [
  {
    id: 'claude-opus',
    providerId: 'anthropic',
    label: 'Claude Opus',
    capabilities: ['chat', 'code'],
    driverModel: 'opus',
    agentCapable: true,
    pricing: { inputPer1kUsd: 0.015, outputPer1kUsd: 0.075 },
  },
  {
    id: 'claude-sonnet',
    providerId: 'anthropic',
    label: 'Claude Sonnet',
    capabilities: ['chat', 'code'],
    driverModel: 'sonnet',
    agentCapable: true,
    pricing: { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
  },
  {
    id: 'claude-haiku',
    providerId: 'anthropic',
    label: 'Claude Haiku',
    capabilities: ['chat', 'code'],
    driverModel: 'haiku',
    agentCapable: true,
    pricing: { inputPer1kUsd: 0.00025, outputPer1kUsd: 0.00125 },
  },
];

/** Build a fresh copy of the default registry (never share mutable state). */
export function createDefaultRegistry(): ModelRegistry {
  return {
    providers: [{ ...ANTHROPIC_PROVIDER }, { ...BEDROCK_PROVIDER }],
    models: CLAUDE_MODELS.map((m) => ({ ...m })),
    routing: {
      chat: {
        smort: ['claude-opus', 'claude-sonnet'],
        good: ['claude-sonnet', 'claude-haiku'],
        cheap: ['claude-haiku'],
      },
      code: {
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
