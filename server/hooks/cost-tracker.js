/**
 * Tracks estimated token costs per surface/session.
 *
 * Uses a PostToolUse hook to count tool invocations and estimate costs
 * based on the configured model's pricing.  The tracker maintains per-
 * surfaceId cost buckets so callers can query spend by surface or in
 * aggregate.
 *
 * Pricing is per 1M tokens (input / output):
 *   - opus:   $15 / $75
 *   - sonnet: $3  / $15
 *   - haiku:  $0.25 / $1.25
 *
 * Token counts are estimated from tool call metadata when available;
 * otherwise a conservative per-call estimate is used.
 *
 * @param {Object} options
 * @param {string} [options.model='sonnet'] - Model name for pricing lookup
 * @param {string} [options.surfaceId]      - Default surface identifier
 * @returns {{ hookConfig: Object, getCost: Function, getTotalCost: Function, reset: Function }}
 */
export function createCostTracker(options = {}) {
  // Per 1M tokens: { input, output }
  const PRICING = {
    opus:   { input: 15,   output: 75 },
    sonnet: { input: 3,    output: 15 },
    haiku:  { input: 0.25, output: 1.25 },
  };

  // Fallback per-tool-call token estimate when real counts are unavailable
  const DEFAULT_INPUT_TOKENS  = 500;
  const DEFAULT_OUTPUT_TOKENS = 200;

  const model = resolveModel(options.model || 'sonnet');
  const pricing = PRICING[model] || PRICING.sonnet;

  /** @type {Map<string, { inputTokens: number, outputTokens: number, calls: number }>} */
  const costs = new Map();

  /**
   * Normalise a model identifier to a pricing tier.
   * Accepts full identifiers like "claude-3-5-sonnet-20241022".
   */
  function resolveModel(name) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('opus'))   return 'opus';
    if (lower.includes('haiku'))  return 'haiku';
    return 'sonnet'; // default tier
  }

  function ensureBucket(surfaceId) {
    if (!costs.has(surfaceId)) {
      costs.set(surfaceId, { inputTokens: 0, outputTokens: 0, calls: 0 });
    }
    return costs.get(surfaceId);
  }

  function computeDollars(bucket) {
    const inputCost  = (bucket.inputTokens  / 1_000_000) * pricing.input;
    const outputCost = (bucket.outputTokens / 1_000_000) * pricing.output;
    return {
      input:  inputCost,
      output: outputCost,
      total:  inputCost + outputCost,
      inputTokens:  bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      calls: bucket.calls,
      model,
    };
  }

  const hook = async (input) => {
    const surfaceId = options.surfaceId || 'unknown';
    const bucket = ensureBucket(surfaceId);

    // Prefer real token counts from Agent SDK metadata
    const inputTokens  = input.input_tokens  ?? input.usage?.input_tokens  ?? DEFAULT_INPUT_TOKENS;
    const outputTokens = input.output_tokens ?? input.usage?.output_tokens ?? DEFAULT_OUTPUT_TOKENS;

    bucket.inputTokens  += inputTokens;
    bucket.outputTokens += outputTokens;
    bucket.calls        += 1;

    return {};
  };

  return {
    hookConfig: {
      PostToolUse: [{ matcher: '.*', hooks: [hook] }],
    },

    /**
     * Get cost breakdown for a specific surface.
     * @param {string} surfaceId
     * @returns {Object|null} Cost breakdown or null if no data
     */
    getCost(surfaceId) {
      const bucket = costs.get(surfaceId);
      return bucket ? computeDollars(bucket) : null;
    },

    /**
     * Get aggregated cost across all surfaces.
     * @returns {Object} Aggregated cost breakdown
     */
    getTotalCost() {
      const totals = { inputTokens: 0, outputTokens: 0, calls: 0 };
      for (const bucket of costs.values()) {
        totals.inputTokens  += bucket.inputTokens;
        totals.outputTokens += bucket.outputTokens;
        totals.calls        += bucket.calls;
      }
      return computeDollars(totals);
    },

    /**
     * Reset all tracked costs.
     */
    reset() {
      costs.clear();
    },
  };
}
