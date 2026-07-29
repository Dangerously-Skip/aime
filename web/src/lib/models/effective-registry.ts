/**
 * The *effective* registry: the built-in Claude registry plus the models the
 * user scanned and enabled on their own providers, slotted into the
 * capability × tier grid so a tier request can actually resolve to a user model.
 *
 * Why this exists: `createDefaultRegistry()` is static, and `ScannedModel`
 * carries no tier. Without this, selecting "Smort" could never reach Kimi K2 no
 * matter how many providers were added. Tier assignment is inferred from output
 * price (the dimension vendors themselves segment on) and is user-overridable —
 * a scan can return hundreds of models, so inference must do the bulk work.
 *
 * Pure and client-safe: the client resolves a tier to a concrete
 * {model, providerConfig} at send time and sends it as an explicit model, so the
 * server needs no knowledge of the user's provider list.
 */
import { getPreset } from './providers';
import { resolveRoute } from './registry';
import type { ProviderConfig, ScannedModel, Transport } from './providers';
import type { ProviderExecConfig } from './execution';
import {
  type Capability,
  type Model,
  type ModelPricing,
  type ModelProvider,
  type ModelRegistry,
  type ProviderKind,
  type Tier,
  TIER_ORDER,
} from './types';

/**
 * Output-price bands (USD per 1k output tokens), anchored to the built-in Claude
 * ladder so a tier means the same economic thing across providers:
 * haiku 0.005 → cheap, sonnet 0.015 → good, opus 0.025 → smort, fable 0.050 → stallion.
 */
export const TIER_PRICE_CEILINGS: ReadonlyArray<{ tier: Tier; maxOutputPer1kUsd: number }> = [
  { tier: 'cheap', maxOutputPer1kUsd: 0.008 },
  { tier: 'good', maxOutputPer1kUsd: 0.02 },
  { tier: 'smort', maxOutputPer1kUsd: 0.04 },
  { tier: 'stallion', maxOutputPer1kUsd: Infinity },
];

/**
 * Infer a tier from pricing. Returns null when there's no usable price signal —
 * notably free/local models, where price is meaningless (a 3B and a 70B are both
 * $0) and the user must choose. Callers decide the fallback.
 */
export function inferTier(pricing?: ModelPricing): Tier | null {
  const out = pricing?.outputPer1kUsd;
  if (out == null || !Number.isFinite(out) || out <= 0) return null;
  for (const band of TIER_PRICE_CEILINGS) {
    if (out <= band.maxOutputPer1kUsd) return band.tier;
  }
  return 'stallion';
}

/** Registry provider `kind` for a user provider, derived from its transport. */
export function kindForTransport(transport: Transport | undefined, presetId: string): ProviderKind {
  if (transport === 'native-fal') return 'fal';
  if (transport === 'openai-compat') return presetId === 'local' ? 'local' : 'openai';
  // anthropic-native: a user-added one is reached via a base URL, i.e. a
  // proxy speaking the Anthropic wire format — except Anthropic itself.
  return presetId === 'anthropic' ? 'anthropic' : 'anthropic-compat';
}

/**
 * Which wire format a SPECIFIC model on this provider must use.
 *
 * Providers used to carry one transport for their whole catalogue, which broke
 * aggregators: OpenRouter is `anthropic-native`, so google/gemini-* and
 * moonshotai/kimi-* were sent to /api/v1/messages — an Anthropic-format endpoint
 * that only serves `anthropic/*` — and came back "There's an issue with the
 * selected model". Non-native models go through the openai-compat shim instead,
 * which already exists for exactly this (see execution.ts).
 */
export function transportForModel(
  presetId: string,
  modelId: string,
  presetTransport: Transport | undefined,
): Transport | undefined {
  const prefix = getPreset(presetId)?.nativeModelPrefix;
  if (!prefix) return presetTransport;
  return modelId.startsWith(prefix) ? presetTransport : 'openai-compat';
}

/** The composite option id used across the client for a user provider's model. */
export function userModelId(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/** A configured provider as the effective-registry builder needs it. */
export interface ProviderWithModels extends ProviderConfig {
  models: ScannedModel[];
}

/**
 * Explicit per-tier model choices, keyed by tier. The value is a registry model
 * id — either a built-in (`claude-opus`) or a composite (`prov-1:kimi-k2`).
 * These win over price inference; that's the "user adjusts slots" affordance.
 */
export type TierAssignments = Partial<Record<Tier, string>>;

/** Agent capabilities — the ones that must be driven through the Agent SDK. */
const AGENT_CAPABILITIES: Capability[] = ['chat', 'code'];

/**
 * Merge enabled user providers' models into a copy of `base`.
 *
 * - Each enabled provider becomes a `ModelProvider` (kind derived from transport).
 * - Each of its models becomes a `Model`, with capabilities defaulting to the
 *   agent capabilities when the scan didn't classify them.
 * - Models are appended to the routing candidates for their inferred tier, so
 *   built-ins stay primary and user models act as fallbacks — until an explicit
 *   `tierAssignments` entry promotes one to the front of that tier.
 *
 * `native-fal` providers are capability-only and never enter agent routing.
 */
export function buildEffectiveRegistry(
  base: ModelRegistry,
  providers: ProviderWithModels[],
  tierAssignments: TierAssignments = {},
): ModelRegistry {
  const providersOut: ModelProvider[] = [...base.providers];
  const modelsOut: Model[] = [...base.models];
  // Deep-enough copy: capability → tier → candidate array (arrays are rebuilt).
  const routing: ModelRegistry['routing'] = {};
  for (const [capability, byTier] of Object.entries(base.routing)) {
    const copy: Partial<Record<Tier, string[]>> = {};
    for (const [tier, ids] of Object.entries(byTier ?? {})) {
      copy[tier as Tier] = [...(ids ?? [])];
    }
    routing[capability as Capability] = copy;
  }

  for (const p of providers) {
    if (!p.enabled) continue;
    const preset = getPreset(p.presetId);
    const transport = preset?.transport;
    if (transport === 'native-fal') continue; // capability-only

    providersOut.push({
      id: p.id,
      label: p.label,
      kind: kindForTransport(transport, p.presetId),
    });

    for (const m of p.models) {
      const id = userModelId(p.id, m.id);
      const capabilities = m.capabilities?.length
        ? m.capabilities
        : AGENT_CAPABILITIES;
      modelsOut.push({
        id,
        providerId: p.id,
        label: m.label || m.id,
        capabilities,
        driverModel: m.id,
        agentCapable: true,
        contextWindow: m.contextWindow,
        pricing: m.pricing,
      });

      // Route it under its inferred tier for each agent capability it serves.
      const tier = inferTier(m.pricing);
      if (!tier) continue; // unpriced/local — reachable only via explicit assignment
      for (const capability of capabilities) {
        if (!AGENT_CAPABILITIES.includes(capability)) continue;
        const byTier = (routing[capability] ??= {});
        (byTier[tier] ??= []).push(id);
      }
    }
  }

  // Explicit assignments win: promote the chosen model to the front of its tier
  // for every agent capability it can serve.
  for (const tier of TIER_ORDER) {
    const chosenId = tierAssignments[tier];
    if (!chosenId) continue;
    const model = modelsOut.find((m) => m.id === chosenId);
    if (!model) continue; // stale assignment (provider removed) — ignore
    for (const capability of model.capabilities) {
      if (!AGENT_CAPABILITIES.includes(capability)) continue;
      const byTier = (routing[capability] ??= {});
      const list = (byTier[tier] ??= []);
      byTier[tier] = [chosenId, ...list.filter((x) => x !== chosenId)];
    }
  }

  return { providers: providersOut, models: modelsOut, routing };
}

/**
 * What the client sends for a resolved route: the driver model name plus, for a
 * user provider's model, the exec config the server needs. Built-ins get no
 * providerConfig (they run on the default Anthropic/Bedrock path).
 */
export interface ClientRoute {
  model: string;
  providerConfig?: ProviderExecConfig;
}

/**
 * Build the `providerConfig` for a resolved model, or undefined for a built-in.
 * Exported so a pinned-model selection can reuse the same derivation.
 */
export function execConfigFor(
  model: Model,
  providers: ProviderWithModels[],
): ProviderExecConfig | undefined {
  const provider = providers.find((p) => p.id === model.providerId);
  if (!provider) return undefined; // built-in
  const preset = getPreset(provider.presetId);
  return {
    providerId: provider.id,
    transport: transportForModel(provider.presetId, model.driverModel, preset?.transport),
    baseUrl: provider.baseUrl ?? preset?.defaultBaseUrl,
    // Bedrock/Vertex are environment-driven; without this the server cannot tell
    // them from an ordinary key+URL provider and they resolve to nothing.
    agentMode: preset?.agentMode,
  };
}

/**
 * Resolve a (capability, tier) request client-side against the effective
 * registry, returning what to send. Doing this on the client — rather than
 * teaching the server about the user's provider list — keeps the request shape
 * unchanged: a resolved tier is sent as an ordinary explicit model.
 *
 * A built-in provider is available only when there's an Anthropic key (BYOK) or
 * Bedrock; user providers are available when enabled (their key lives in the
 * keychain, so the client can only assume). Returns null when nothing resolves.
 */
export function resolveClientRoute(
  capability: Capability,
  tier: Tier,
  providers: ProviderWithModels[],
  opts: {
    base: ModelRegistry;
    tierAssignments?: TierAssignments;
    hasAnthropicKey?: boolean;
    hasBedrock?: boolean;
  },
): ClientRoute | null {
  // Imported lazily-but-statically: resolveRoute is pure and tree-shakeable.
  const registry = buildEffectiveRegistry(opts.base, providers, opts.tierAssignments ?? {});
  const userProviderIds = new Set(providers.filter((p) => p.enabled).map((p) => p.id));
  const builtinOk = Boolean(opts.hasAnthropicKey || opts.hasBedrock);

  const resolved = resolveRoute(registry, capability, tier, (p) => {
    if (userProviderIds.has(p.id)) return true;
    if (p.id === 'bedrock') return Boolean(opts.hasBedrock);
    return builtinOk;
  });
  if (!resolved) return null;

  const providerConfig = execConfigFor(resolved.model, providers);
  return providerConfig
    ? { model: resolved.model.driverModel, providerConfig }
    : { model: resolved.model.driverModel };
}
