import { describe, it, expect } from 'vitest';
import { pricingFor, estimateCostUsd } from './pricing';
import { createDefaultRegistry } from './registry';

/**
 * The bug these exist for: the chat route hardcoded `opus → $0.015/$0.075 per
 * 1k`, which were Opus 4.1-era prices. When Opus 5 landed at $0.005/$0.025 every
 * Opus run was reported at THREE TIMES its real cost — and nothing failed,
 * because a stale constant does not throw. ROI telemetry is the number people
 * make decisions on, so "quietly wrong" is the expensive failure mode.
 */

describe('prices come from the registry, not a second copy', () => {
  it('matches the registry for every model in it', () => {
    for (const m of createDefaultRegistry().models) {
      if (!m.pricing) continue;
      expect(pricingFor(m.driverModel), m.driverModel).toEqual({
        input: m.pricing.inputPer1kUsd,
        output: m.pricing.outputPer1kUsd,
      });
    }
  });

  /**
   * The regression. If someone reintroduces a hardcoded table, or the registry
   * drifts from reality, this is the assertion that notices.
   */
  it('prices Opus at the current rate, not the 4.1-era one', () => {
    const opus = pricingFor('claude-opus-5');
    expect(opus.input).toBeCloseTo(0.005, 5);
    expect(opus.output).toBeCloseTo(0.025, 5);
    expect(opus.input, 'the stale $0.015 is back').not.toBeCloseTo(0.015, 5);
  });

  it('recognises a model under every spelling it arrives in', () => {
    const direct = pricingFor('claude-opus-5');
    // SDK alias, OpenRouter namespacing, Bedrock namespacing.
    expect(pricingFor('opus')).toEqual(direct);
    expect(pricingFor('anthropic/claude-opus-5')).toEqual(direct);
    expect(pricingFor('anthropic.claude-opus-5')).toEqual(direct);
  });

  it('distinguishes the tiers', () => {
    const opus = pricingFor('claude-opus-5');
    const sonnet = pricingFor('claude-sonnet-5');
    const haiku = pricingFor('claude-haiku-4-5');
    expect(opus.output).toBeGreaterThan(sonnet.output);
    expect(sonnet.output).toBeGreaterThan(haiku.output);
  });

  /**
   * An unknown model must not be free. Guessing the cheapest would understate
   * spend, and understating is the direction that surprises someone.
   */
  it('falls back to a mid-range price rather than zero', () => {
    const unknown = pricingFor('some-byok-model-nobody-scanned');
    expect(unknown.input).toBeGreaterThan(0);
    expect(unknown.output).toBeGreaterThan(0);
    expect(unknown.output).toBeLessThan(pricingFor('claude-opus-5').output);
  });
});

describe('estimateCostUsd', () => {
  it('charges input and output at their own rates', () => {
    // 1M input + 1M output on Opus 5 = $5 + $25.
    expect(estimateCostUsd('claude-opus-5', 1_000_000, 1_000_000)).toBeCloseTo(30, 2);
  });

  it('is zero for a turn that used nothing', () => {
    expect(estimateCostUsd('claude-opus-5', 0, 0)).toBe(0);
  });

  it('scales linearly', () => {
    const one = estimateCostUsd('claude-sonnet-5', 10_000, 10_000);
    const ten = estimateCostUsd('claude-sonnet-5', 100_000, 100_000);
    expect(ten).toBeCloseTo(one * 10, 6);
  });
});
