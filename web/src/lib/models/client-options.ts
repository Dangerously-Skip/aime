/**
 * Options for the model picker. The picker offers a **route**: either a tier
 * ("Auto — Good", resolved through the effective registry at send time) or a
 * pinned model.
 *
 * Deliberately bounded: a scan can return ~345 models, so the dropdown NEVER
 * enumerates a provider's catalog. It shows the four tiers, the built-ins, and
 * only those provider models that are actually referenced (a tier assignment,
 * or the current selection). Browsing the full catalog belongs in the Settings
 * tier grid, which has search.
 *
 * Pure and client-safe.
 */
import { getPreset } from './providers';
import { createDefaultRegistry } from './registry';
import type { ProviderExecConfig } from './execution';
import { TIER_ORDER, type Capability, type Tier } from './types';
import {
  resolveClientRoute,
  transportForModel,
  userModelId,
  type ClientRoute,
  type ProviderWithModels,
  type TierAssignments,
} from './effective-registry';

export const BUILTIN_GROUP = 'Built-in (Claude)';
export const TIER_GROUP = 'Automatic';

export const TIER_LABELS: Record<Tier, string> = {
  stallion: 'Stallion — top coding',
  smort: 'Smort — most capable',
  good: 'Good — balanced',
  cheap: 'Cheap — fastest',
};

export interface ModelOption {
  /** Unique select value: `tier:<tier>`, a built-in id, or `${providerId}:${modelId}`. */
  id: string;
  label: string;
  group: string;
  /** 'tier' resolves at send time; 'model' is a hard pin. */
  kind: 'tier' | 'model';
  /** For kind 'tier'. */
  tier?: Tier;
  /** For kind 'model': the driver model name to send as `model`. */
  model?: string;
  /** For kind 'model' on a user provider. */
  providerConfig?: ProviderExecConfig;
}

export interface BuiltinModel {
  id: string;
  label: string;
  /** Driver model name; falls back to `id` (the SDK short name). */
  driverModel?: string;
}

/** The slice of a configured provider this builder needs. */
export interface ConfiguredProviderLite {
  id: string;
  presetId: string;
  label: string;
  baseUrl?: string;
  enabled: boolean;
  models: Array<{ id: string; label?: string }>;
}

/**
 * Which tier to try first when nothing is pinned and the user has no built-in
 * credentials. Mid-range first: the cheapest tier is often a tiny model, and the
 * premium tiers are frequently unpopulated for a single provider.
 */
const DEFAULT_TIER_PREFERENCE: readonly Tier[] = ['good', 'smort', 'cheap', 'stallion'];

export const TIER_OPTION_PREFIX = 'tier:';

/** Is this select value a tier route rather than a pinned model? */
export function isTierOption(id: string): boolean {
  return id.startsWith(TIER_OPTION_PREFIX);
}

/** The tier encoded in a tier option id, or null. */
export function tierFromOptionId(id: string): Tier | null {
  if (!isTierOption(id)) return null;
  const tier = id.slice(TIER_OPTION_PREFIX.length) as Tier;
  return TIER_ORDER.includes(tier) ? tier : null;
}

/** The four tier routes, premium-first, as picker options. */
export function buildTierOptions(): ModelOption[] {
  return TIER_ORDER.map((tier) => ({
    id: `${TIER_OPTION_PREFIX}${tier}`,
    label: TIER_LABELS[tier],
    group: TIER_GROUP,
    kind: 'tier' as const,
    tier,
  }));
}

/**
 * Build the picker's options.
 *
 * @param opts.tierModels  tier→modelId assignments; those models are surfaced
 * @param opts.includeModelIds  extra option ids to surface (e.g. the current
 *   selection, so a pinned model doesn't vanish from its own dropdown)
 * @param opts.includeTiers  set false to show models only (legacy callers)
 */
export function buildModelOptions(
  builtins: BuiltinModel[],
  providers: ConfiguredProviderLite[],
  opts: {
    tierModels?: TierAssignments;
    includeModelIds?: string[];
    includeTiers?: boolean;
  } = {},
): ModelOption[] {
  const out: ModelOption[] = [];
  if (opts.includeTiers !== false) out.push(...buildTierOptions());

  for (const b of builtins) {
    out.push({
      id: b.id,
      label: b.label,
      group: BUILTIN_GROUP,
      kind: 'model',
      model: b.driverModel ?? b.id,
    });
  }

  // Only referenced provider models — never the whole catalog.
  const surface = new Set<string>([
    ...Object.values(opts.tierModels ?? {}).filter((v): v is string => Boolean(v)),
    ...(opts.includeModelIds ?? []),
  ]);

  for (const p of providers) {
    if (!p.enabled) continue;
    const preset = getPreset(p.presetId);
    const transport = preset?.transport;
    const baseUrl = p.baseUrl ?? preset?.defaultBaseUrl;
    for (const m of p.models) {
      const id = userModelId(p.id, m.id);
      if (!surface.has(id)) continue;
      out.push({
        id,
        label: m.label || m.id,
        group: p.label,
        kind: 'model',
        model: m.id,
        // Per model, not per provider: an aggregator's Anthropic endpoint only
        // serves its own vendor, so the rest go via the openai-compat shim.
        providerConfig: {
          providerId: p.id,
          transport: transportForModel(p.presetId, m.id, transport),
          baseUrl,
        },
      });
    }
  }

  return out;
}

/** Look an option up by its select value. */
export function findOption(options: ModelOption[], id: string): ModelOption | undefined {
  return options.find((o) => o.id === id);
}

/** Options grouped by heading, preserving insertion order, for rendering. */
export function groupOptions(options: ModelOption[]): Array<{ group: string; items: ModelOption[] }> {
  const groups: Array<{ group: string; items: ModelOption[] }> = [];
  for (const opt of options) {
    let g = groups.find((x) => x.group === opt.group);
    if (!g) {
      g = { group: opt.group, items: [] };
      groups.push(g);
    }
    g.items.push(opt);
  }
  return groups;
}

/** How a credential-less selection resolves: which tier won, and where it lands. */
export interface DefaultRoute {
  tier: Tier;
  route: ClientRoute;
}

/**
 * Where a turn goes when NOTHING is pinned. Every surface defaults to a BUILT-IN
 * Claude id ('sonnet'), which needs Anthropic credentials — so a user whose only
 * provider is OpenRouter went down the built-in path, no key was found, and the
 * Agent SDK asked them to log in to Anthropic. That defeats the purpose of BYOK:
 * the reason to bring an OpenRouter key is not needing an Anthropic account.
 *
 * With no Anthropic/Bedrock credential we resolve through the effective registry
 * instead — it already knows how to land a tier on a user provider's model.
 * Returns null when a built-in credential exists (the surface default is then
 * correct) or when nothing resolves.
 *
 * Shared so the picker can DISPLAY the same route the send path will take: the
 * selector used to show "Sonnet 4.6" while every turn went to OpenRouter.
 */
export function defaultRoute(
  providers: ProviderWithModels[],
  opts: {
    capability: Capability;
    tierModels?: TierAssignments;
    hasAnthropicKey?: boolean;
    hasBedrock?: boolean;
    /**
     * Has built-in reachability actually been determined? Defaults true.
     *
     * While the answer is outstanding `hasAnthropicKey` is `false` because it is
     * unknown, not because it is absent — and rerouting on that sent the turn,
     * and the billing, to a BYOK provider for a user who had a server-side key.
     * Unknown means "leave it alone", matching the picker, which keeps offering
     * the built-ins until it hears otherwise.
     */
    known?: boolean;
  },
): DefaultRoute | null {
  if (opts.known === false) return null;
  if (opts.hasAnthropicKey || opts.hasBedrock) return null;
  if (!providers.some((p) => p.enabled && p.models.length > 0)) return null;
  for (const tier of DEFAULT_TIER_PREFERENCE) {
    const route = resolveClientRoute(opts.capability, tier, providers, {
      base: createDefaultRegistry(),
      tierAssignments: opts.tierModels,
      hasAnthropicKey: opts.hasAnthropicKey,
      hasBedrock: opts.hasBedrock,
    });
    if (route) return { tier, route };
  }
  return null;
}

/**
 * What to send for the current selection. A pinned model is sent as-is; a tier
 * is resolved through the effective registry (so it can land on a user
 * provider's model). Returns null if a tier resolves to nothing — the caller
 * should then fall back to its surface default rather than send garbage.
 */
export function resolveSendRoute(
  selection: ModelOption | null,
  providers: ProviderWithModels[],
  opts: {
    capability: Capability;
    tierModels?: TierAssignments;
    hasAnthropicKey?: boolean;
    hasBedrock?: boolean;
    /** See `defaultRoute` — unknown reachability must not reroute. */
    known?: boolean;
  },
): ClientRoute | null {
  // Nothing pinned — resolve the implicit route (see defaultRoute). Done here
  // rather than in each surface, because all four call this function and one
  // forgetting is how the gap appeared.
  if (!selection) return defaultRoute(providers, opts)?.route ?? null;
  if (selection.kind === 'model') {
    return selection.model
      ? { model: selection.model, providerConfig: selection.providerConfig }
      : null;
  }
  if (!selection.tier) return null;
  return resolveClientRoute(opts.capability, selection.tier, providers, {
    base: createDefaultRegistry(),
    tierAssignments: opts.tierModels,
    hasAnthropicKey: opts.hasAnthropicKey,
    hasBedrock: opts.hasBedrock,
  });
}

/**
 * Every model that could fill a tier slot, for the Settings grid's searchable
 * picker. This one DOES span the full catalog — it is search-backed, unlike the
 * bounded send-time dropdown.
 */
export function buildTierSlotCandidates(
  builtins: BuiltinModel[],
  providers: ProviderWithModels[],
): Array<{ id: string; label: string; group: string; outputPer1kUsd?: number }> {
  const out: Array<{ id: string; label: string; group: string; outputPer1kUsd?: number }> =
    builtins.map((b) => ({ id: b.id, label: b.label, group: BUILTIN_GROUP }));
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      out.push({
        id: userModelId(p.id, m.id),
        label: m.label || m.id,
        group: p.label,
        outputPer1kUsd: m.pricing?.outputPer1kUsd,
      });
    }
  }
  return out;
}
