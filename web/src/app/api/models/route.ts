import { isBedrockConfigured } from '@/lib/bedrock-env';
import { getServerAnthropicKey } from '@/lib/models/credentials';
import { createDefaultRegistry } from '@/lib/models/registry';
import { TIER_ORDER } from '@/lib/models/types';

export const runtime = 'nodejs';

/**
 * List models from the registry, plus the capability × tier grid a selector
 * can build from. Reflects the default (Claude) registry; user-added providers
 * layer on client-side via the provider store.
 * GET /api/models
 */
export async function GET() {
  const reg = createDefaultRegistry();

  const models = reg.models.map((m) => ({
    id: m.id,
    label: m.label,
    driverModel: m.driverModel,
    capabilities: m.capabilities,
    agentCapable: m.agentCapable,
    contextWindow: m.contextWindow,
    pricing: m.pricing,
  }));

  // capability → tiers that have at least one routed candidate
  const routing: Record<string, string[]> = {};
  for (const [capability, byTier] of Object.entries(reg.routing)) {
    routing[capability] = TIER_ORDER.filter((t) => (byTier?.[t]?.length ?? 0) > 0);
  }

  return Response.json({
    models,
    tiers: TIER_ORDER,
    capabilities: Object.keys(reg.routing),
    routing,
    default: { capability: 'chat', tier: 'good' },
    // Which built-in (Claude) credentials this server can reach. Booleans only —
    // no key material. The picker needs them to decide whether to OFFER the
    // built-in models at all: a BYOK-only user was shown "Built-in (Claude)"
    // entries that could never run. The key saved in Settings counts too: it
    // lives in the encrypted credential store, and the server uses it for any
    // request that arrives without one — so the client need not hold it to
    // know the built-ins are reachable.
    anthropic: !!process.env.ANTHROPIC_API_KEY || !!(await getServerAnthropicKey()),
    bedrock: isBedrockConfigured(),
  });
}
