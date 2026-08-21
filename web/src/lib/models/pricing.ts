import { createDefaultRegistry } from './registry';

/**
 * Fallback cost estimate, for when the provider did not report a real one.
 *
 * ## Read this before using the number
 *
 * This is an ESTIMATE and the caller must label it as one. The real figure comes
 * from the Agent SDK's terminal result message (`total_cost_usd`), which is
 * computed from the API's own usage; the route prefers that and only falls back
 * here. A number that might be measured and might be guessed, with no way to
 * tell them apart, is worse than either alone — which is why `done.usage` also
 * carries `estimated`.
 *
 * ## Why prices come from the registry
 *
 * The previous version hardcoded a per-model table inline in the chat route:
 * anything matching `opus` cost $0.015/$0.075 per 1k. Those were Opus 4.1-era
 * prices, so every Opus run was overstated THREEFOLD once Opus 5 landed at
 * $0.005/$0.025. Nothing failed — the number just quietly became wrong, and ROI
 * telemetry is precisely the thing people make decisions on.
 *
 * The registry already carries `pricing` for every model, including ones scanned
 * from a user's own provider, so it is the one place a price should live. A
 * BYOK model priced by its provider now estimates correctly too, which the
 * inline table could never do.
 */

/**
 * Sonnet-tier pricing, used only when a model is not in the registry at all
 * (an unscanned BYOK model, say). Deliberately mid-range: guessing the cheapest
 * would understate spend, and understating is the direction that surprises
 * someone.
 */
const FALLBACK_PER_1K = { input: 0.003, output: 0.015 };

/**
 * Find a model's per-1k prices.
 *
 * Matching is deliberately loose because the same model arrives spelled several
 * ways: an SDK alias (`opus`), a concrete id (`claude-opus-5`), or a
 * provider-namespaced one (`anthropic/claude-opus-5`, `anthropic.claude-opus-5`).
 */
export function pricingFor(model: string): { input: number; output: number } {
  const needle = model.toLowerCase();
  for (const m of createDefaultRegistry().models) {
    if (!m.pricing) continue;
    const driver = m.driverModel.toLowerCase();
    // Either spelling implies the other: `opus` appears inside
    // `anthropic/claude-opus-5`, and `claude-fable-5` contains its own alias.
    if (needle === driver || needle.includes(driver) || driver.includes(needle)) {
      return { input: m.pricing.inputPer1kUsd, output: m.pricing.outputPer1kUsd };
    }
  }
  return FALLBACK_PER_1K;
}

/**
 * Cache tokens are NOT priced like fresh input, and the difference is the whole
 * story for an agent loop.
 *
 * Anthropic bills a cache READ at a tenth of the input rate and a cache WRITE at
 * 1.25x. A long agentic session re-reads its entire cached prefix on every turn,
 * so cache reads dominate the token count — often by an order of magnitude over
 * fresh input. Folding them into `inputTokens` and charging the full rate, which
 * is what the harness did, therefore overstates the bill by roughly 10x on the
 * dominant term.
 *
 * That is not a rounding error, it is the difference between "$0.60 of $3.00"
 * and "$7.57 of $3.00" — the second of which was reported from a real run and
 * was, correctly, not believed.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prefix served from cache — a tenth of the input rate. */
  cacheReadTokens?: number;
  /** Prefix written INTO the cache — 1.25x the input rate. */
  cacheWriteTokens?: number;
}

/** Estimated USD for a turn. See the caveat at the top of this file. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  return estimateUsageCostUsd(model, { inputTokens, outputTokens });
}

/** Estimated USD for a turn, pricing each class of token at its own rate. */
export function estimateUsageCostUsd(model: string, usage: TokenUsage): number {
  const p = pricingFor(model);
  const per1k = (tokens: number, rate: number) => (tokens / 1000) * rate;
  return (
    per1k(usage.inputTokens, p.input) +
    per1k(usage.outputTokens, p.output) +
    per1k(usage.cacheReadTokens ?? 0, p.input * CACHE_READ_MULTIPLIER) +
    per1k(usage.cacheWriteTokens ?? 0, p.input * CACHE_WRITE_MULTIPLIER)
  );
}
