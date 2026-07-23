/**
 * Model & provider registry types.
 *
 * Surfaces and features request a (capability, tier) pair; the registry
 * resolves it to a concrete Model on a configured ModelProvider, with
 * fallback ("tumbling"). See .planning/p1-model-registry.md for the design
 * and the Agent-SDK-drives-Claude-only constraint that shapes it.
 */

/** What a model is being asked to do. */
export type Capability =
  | 'chat'       // conversational agent turns
  | 'code'       // developer agent turns
  | 'image'      // image generation
  | 'search'     // web/retrieval (today: MCP)
  | 'mesh3d'     // 3D asset generation
  | 'voice'      // speech-to-text (today: local Whisper)
  | 'embedding'; // vector embeddings

/** Quality/cost tier. TIER_ORDER runs premium → cheap for downward tumbling. */
export type Tier = 'cheap' | 'good' | 'smort';

/** Tiers ordered premium-first, so tier-tumbling degrades to the right. */
export const TIER_ORDER: readonly Tier[] = ['smort', 'good', 'cheap'] as const;

/**
 * How a provider is reached.
 * - anthropic / bedrock / vertex — Claude, drivable by the Agent SDK
 * - anthropic-compat — a base-URL proxy speaking the Anthropic wire format
 *   (LiteLLM/OpenRouter); the only way a non-Claude model drives the agent loop
 * - openai / fal / local — direct-SDK providers for capability calls
 *   (image/mesh/voice/embedding) OUTSIDE the agent loop
 */
export type ProviderKind =
  | 'anthropic'
  | 'bedrock'
  | 'vertex'
  | 'anthropic-compat'
  | 'openai'
  | 'fal'
  | 'local';

export interface ModelProvider {
  /** Stable registry id, e.g. 'anthropic', 'my-openrouter'. */
  id: string;
  label: string;
  kind: ProviderKind;
  /**
   * Env var names that, if any is set, indicate this provider is configured.
   * Production availability also considers user-set keys in settings; the
   * pure resolver takes an explicit `isAvailable` predicate instead.
   */
  credentialEnv?: string[];
}

export interface ModelPricing {
  inputPer1kUsd: number;
  outputPer1kUsd: number;
}

export interface Model {
  /** Registry-unique id, e.g. 'claude-opus', 'gpt-5', 'flux-pro'. */
  id: string;
  providerId: string;
  label: string;
  capabilities: Capability[];
  /** Model name the driver/endpoint expects (SDK short name or API model id). */
  driverModel: string;
  /**
   * True if this model can drive the Claude Agent SDK loop (Claude-family, or
   * a non-Claude model behind an anthropic-compat proxy). Required for the
   * 'chat' and 'code' capabilities.
   */
  agentCapable: boolean;
  contextWindow?: number;
  pricing?: ModelPricing;
}

/**
 * capability → tier → ordered candidate model ids. Index 0 is the primary;
 * the rest are same-tier tumbling fallbacks tried in order.
 */
export type RoutingTable = Partial<Record<Capability, Partial<Record<Tier, string[]>>>>;

export interface ModelRegistry {
  providers: ModelProvider[];
  models: Model[];
  routing: RoutingTable;
}

/** Result of resolving a (capability, tier) request against the registry. */
export interface ResolvedRoute {
  model: Model;
  provider: ModelProvider;
  capability: Capability;
  /** The tier actually served (may be lower than requested after tier-tumbling). */
  tier: Tier;
  /** True if a non-primary candidate or a lower tier was selected. */
  degraded: boolean;
}
