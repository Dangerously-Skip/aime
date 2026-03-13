import type { PostToolUseInput, HookConfig } from './tool-monitor';

/**
 * Pricing tiers per 1M tokens (input / output).
 */
const PRICING: Record<string, { input: number; output: number }> = {
  opus:   { input: 15,   output: 75 },
  sonnet: { input: 3,    output: 15 },
  haiku:  { input: 0.25, output: 1.25 },
};

/** Fallback per-tool-call token estimate when real counts are unavailable. */
const DEFAULT_INPUT_TOKENS = 500;
const DEFAULT_OUTPUT_TOKENS = 200;

interface CostBucket {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  model: string;
}

export interface CostTrackerOptions {
  model?: string;
  surfaceId?: string;
  chatId?: string;
}

export interface CostTrackerResult {
  hookConfig: HookConfig;
  getCost: (surfaceId: string) => CostBreakdown | null;
  getTotalCost: () => CostBreakdown;
  reset: () => void;
}

/**
 * Normalise a model identifier to a pricing tier.
 * Accepts full identifiers like "claude-3-5-sonnet-20241022".
 */
function resolveModel(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  return 'sonnet'; // default tier
}

/**
 * Tracks estimated token costs per surface/session.
 *
 * Uses a PostToolUse hook to count tool invocations and estimate costs
 * based on the configured model's pricing. The tracker maintains per-
 * surfaceId cost buckets so callers can query spend by surface or in
 * aggregate.
 */
export function createCostTracker(options: CostTrackerOptions = {}): CostTrackerResult {
  const model = resolveModel(options.model || 'sonnet');
  const pricing = PRICING[model] || PRICING.sonnet;

  const costs = new Map<string, CostBucket>();

  function ensureBucket(surfaceId: string): CostBucket {
    if (!costs.has(surfaceId)) {
      costs.set(surfaceId, { inputTokens: 0, outputTokens: 0, calls: 0 });
    }
    return costs.get(surfaceId)!;
  }

  function computeDollars(bucket: CostBucket): CostBreakdown {
    const inputCost = (bucket.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (bucket.outputTokens / 1_000_000) * pricing.output;
    return {
      input: inputCost,
      output: outputCost,
      total: inputCost + outputCost,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      calls: bucket.calls,
      model,
    };
  }

  const hook = async (input: PostToolUseInput): Promise<Record<string, unknown>> => {
    const surfaceId = options.surfaceId || 'unknown';
    const bucket = ensureBucket(surfaceId);

    // Prefer real token counts from Agent SDK metadata
    const inputTokens = input.input_tokens ?? input.usage?.input_tokens ?? DEFAULT_INPUT_TOKENS;
    const outputTokens = input.output_tokens ?? input.usage?.output_tokens ?? DEFAULT_OUTPUT_TOKENS;

    bucket.inputTokens += inputTokens;
    bucket.outputTokens += outputTokens;
    bucket.calls += 1;

    return {};
  };

  return {
    hookConfig: {
      PostToolUse: [{ matcher: '.*', hooks: [hook] }],
    },

    /**
     * Get cost breakdown for a specific surface.
     */
    getCost(surfaceId: string): CostBreakdown | null {
      const bucket = costs.get(surfaceId);
      return bucket ? computeDollars(bucket) : null;
    },

    /**
     * Get aggregated cost across all surfaces.
     */
    getTotalCost(): CostBreakdown {
      const totals: CostBucket = { inputTokens: 0, outputTokens: 0, calls: 0 };
      for (const bucket of costs.values()) {
        totals.inputTokens += bucket.inputTokens;
        totals.outputTokens += bucket.outputTokens;
        totals.calls += bucket.calls;
      }
      return computeDollars(totals);
    },

    /**
     * Reset all tracked costs.
     */
    reset(): void {
      costs.clear();
    },
  };
}
