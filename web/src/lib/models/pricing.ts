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

/** Estimated USD for a turn. See the caveat at the top of this file. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = pricingFor(model);
  return (inputTokens / 1000) * p.input + (outputTokens / 1000) * p.output;
}
