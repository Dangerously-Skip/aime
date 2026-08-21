/**
 * Model & provider registry types.
 *
 * Surfaces and features request a (capability, tier) pair; the registry
 * resolves it to a concrete Model on a configured ModelProvider, with
 * fallback ("tumbling"). The rules live in resolveRoute; see its comments for
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

/**
 * Quality/cost tier. TIER_ORDER runs premium → cheap for downward tumbling.
 * `stallion` is the premium-most tier, reserved for the hardest coding work
 * (e.g. Fable); most capabilities don't populate it and tumble down to smort.
 */
export type Tier = 'cheap' | 'good' | 'smort' | 'stallion';

/** Tiers ordered premium-first, so tier-tumbling degrades to the right. */
export const TIER_ORDER: readonly Tier[] = ['stallion', 'smort', 'good', 'cheap'] as const;

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

/** A concrete (capability, tier) target the router can resolve. */
export interface RouteSlot {
  capability: Capability;
  tier: Tier;
}

/**
 * Per-request routing policy layered on top of (capability, tier). Every field
 * is optional; an empty object reproduces plain `resolveRoute` behaviour.
 */
export interface RouteSettings {
  /**
   * Sampling warmth 0..1 → temperature (0 = deterministic, 1 = most varied).
   * Persona/voice is a system-prompt concern (SOUL.md), NOT warmth (DR-4).
   * Honoured by capability calls and openai-compat models; the Claude Agent
   * loop is opinionated and may ignore it.
   */
  warmth?: number;
  /**
   * Cap the effective tier. A request more premium than `maxTier` is clamped
   * down before resolution — a hard cost lever independent of availability.
   */
  maxTier?: Tier;
  /**
   * Skip candidate models whose output price exceeds this per-1k-token ceiling
   * (USD). Unpriced models are always allowed. The floor of "cost compaction".
   */
  costCeilingPer1kUsd?: number;
  /**
   * Explicit fallback chain overriding the default downward tier-tumble. Keyed
   * by `${capability}:${tier}`; the value is an ordered list of slots to try
   * after the primary slot (which is always tried first). When present, the
   * default TIER_ORDER tumble is NOT used for that slot.
   */
  tumbleChains?: Record<string, RouteSlot[]>;
}

/** A resolved route plus the sampling settings derived from RouteSettings. */
export interface ResolvedRouteWithSettings {
  route: ResolvedRoute;
  /** Temperature derived from `warmth`, present only when warmth was set. */
  temperature?: number;
}
