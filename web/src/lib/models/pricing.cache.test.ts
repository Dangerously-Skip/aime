import { describe, it, expect } from 'vitest';
import {
  estimateUsageCostUsd,
  estimateCostUsd,
  pricingFor,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
} from './pricing';

/**
 * CACHE TOKENS ARE NOT FRESH INPUT, AND IN AN AGENT LOOP THEY ARE MOST OF THE BILL.
 *
 * A long agentic session re-reads its entire cached prefix on every turn, so
 * cache reads dominate the token count — routinely by an order of magnitude over
 * fresh input. Anthropic bills a read at a TENTH of the input rate.
 *
 * The harness summed reads, writes and fresh input into one number and charged
 * the full input rate for all of it. That is not a rounding error: a real run
 * reported "Spent $7.57 of $3.00" and was, correctly, not believed.
 */

const MODEL = 'claude-sonnet-4-6';
const rate = pricingFor(MODEL);

describe('each class of token is charged its own rate', () => {
  it('a cache read costs a tenth of fresh input', () => {
    const fresh = estimateUsageCostUsd(MODEL, { inputTokens: 1_000_000, outputTokens: 0 });
    const cached = estimateUsageCostUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 });
    expect(cached).toBeCloseTo(fresh * CACHE_READ_MULTIPLIER, 6);
    expect(CACHE_READ_MULTIPLIER).toBe(0.1);
  });

  it('a cache write costs 1.25x fresh input', () => {
    const fresh = estimateUsageCostUsd(MODEL, { inputTokens: 1_000_000, outputTokens: 0 });
    const written = estimateUsageCostUsd(MODEL, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 });
    expect(written).toBeCloseTo(fresh * CACHE_WRITE_MULTIPLIER, 6);
  });

  it('the classes add up rather than replacing one another', () => {
    const total = estimateUsageCostUsd(MODEL, {
      inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 400,
    });
    const expected =
      (1000 / 1000) * rate.input +
      (500 / 1000) * rate.output +
      (2000 / 1000) * rate.input * CACHE_READ_MULTIPLIER +
      (400 / 1000) * rate.input * CACHE_WRITE_MULTIPLIER;
    expect(total).toBeCloseTo(expected, 8);
  });
});

describe('the magnitude of the bug that was here', () => {
  it('a cache-heavy agent session is ~an order of magnitude cheaper than the old sum', () => {
    /*
     * Shape taken from a real run: a small fresh prompt, a large cached prefix
     * re-read every turn, modest output. The old code did
     * `input + cacheRead + cacheWrite` and charged input rate on the total.
     */
    const usage = { inputTokens: 20_000, outputTokens: 15_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 60_000 };

    const correct = estimateUsageCostUsd(MODEL, usage);
    const oldWay = estimateCostUsd(
      MODEL,
      usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      usage.outputTokens,
    );

    expect(oldWay / correct).toBeGreaterThan(5);
    expect(correct).toBeLessThan(oldWay);
  });

  it('with no cache tokens the two agree exactly', () => {
    // The fix must not move the number for a request that never used the cache.
    const usage = { inputTokens: 12_345, outputTokens: 6_789 };
    expect(estimateUsageCostUsd(MODEL, usage)).toBeCloseTo(
      estimateCostUsd(MODEL, usage.inputTokens, usage.outputTokens), 10,
    );
  });

  it('absent cache fields are zero, not NaN', () => {
    // The provider omits them entirely on backends with no prompt cache.
    const cost = estimateUsageCostUsd(MODEL, { inputTokens: 100, outputTokens: 50 });
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('a BYOK model is charged its OWN rate, not Sonnet-tier', () => {
  /*
   * `pricingFor` searches the BUILT-IN Anthropic registry, so any model that is
   * not in it falls back to Sonnet-tier rates. On an OpenRouter-only setup that
   * is every model — which is why spend still read high after the cache-token
   * fix was in.
   *
   * The real numbers already exist: the OpenRouter scan reads each model's
   * prompt/completion price. They live client-side, so the client sends them.
   */
  const usage = { inputTokens: 1_000_000, outputTokens: 200_000 };

  it('falls back to Sonnet-tier when nothing is known — the old behaviour', () => {
    const fallback = estimateUsageCostUsd('deepseek/deepseek-v4-pro', usage);
    const sonnet = estimateUsageCostUsd('claude-sonnet-4-6', usage);
    expect(fallback).toBeCloseTo(sonnet, 6);
  });

  it('uses the rates it is given instead', () => {
    // DeepSeek is roughly an order of magnitude cheaper than Sonnet.
    const real = { inputPer1kUsd: 0.00027, outputPer1kUsd: 0.0011 };
    const priced = estimateUsageCostUsd('deepseek/deepseek-v4-pro', usage, real);
    expect(priced).toBeCloseTo(1_000 * 0.00027 + 200 * 0.0011, 6);
    expect(priced).toBeLessThan(estimateUsageCostUsd('deepseek/deepseek-v4-pro', usage) / 5);
  });

  it('known rates apply to cache tokens too', () => {
    // Otherwise the dominant term silently reverts to the fallback.
    const real = { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 };
    const withCache = estimateUsageCostUsd(
      'some/model', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }, real,
    );
    expect(withCache).toBeCloseTo(1_000 * 0.001 * CACHE_READ_MULTIPLIER, 6);
  });

  it('null means "I do not know", not "free"', () => {
    // A caller with no pricing must not accidentally zero the bill.
    const a = estimateUsageCostUsd('unknown/model', usage, null);
    expect(a).toBeGreaterThan(0);
  });
});
