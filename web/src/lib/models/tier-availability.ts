/**
 * Which tiers have a model of their OWN for a capability.
 *
 * `resolveClientRoute` tier-tumbles: a "Stallion" request with no stallion
 * model quietly lands on Smort or Good. That is the right send-time behaviour
 * and the wrong thing to offer — the picker listed "Stallion — top coding" as a
 * choice while Settings said "nothing inferred — pick a model", and choosing it
 * bought whatever the tumble found. The picker disables such a tier instead.
 *
 * Same registry, same availability predicate as `resolveClientRoute`; the only
 * difference is `allowTierDegrade: false`. `tier-availability.test.ts` checks
 * the two agree whenever this says a tier is filled.
 *
 * Pure and client-safe.
 */
import { createDefaultRegistry, resolveRoute } from './registry';
import { buildEffectiveRegistry, type ProviderWithModels, type TierAssignments } from './effective-registry';
import { TIER_ORDER, type Capability, type Tier } from './types';

export function filledTiers(
  capability: Capability,
  providers: ProviderWithModels[],
  opts: { tierModels?: TierAssignments; hasAnthropicKey?: boolean; hasBedrock?: boolean },
): Set<Tier> {
  const registry = buildEffectiveRegistry(createDefaultRegistry(), providers, opts.tierModels ?? {});
  const userProviderIds = new Set(providers.filter((p) => p.enabled).map((p) => p.id));
  const builtinOk = Boolean(opts.hasAnthropicKey || opts.hasBedrock);
  const out = new Set<Tier>();
  for (const tier of TIER_ORDER) {
    const resolved = resolveRoute(
      registry,
      capability,
      tier,
      (p) => {
        if (userProviderIds.has(p.id)) return true;
        if (p.id === 'bedrock') return Boolean(opts.hasBedrock);
        return builtinOk;
      },
      { allowTierDegrade: false },
    );
    if (resolved) out.add(tier);
  }
  return out;
}
