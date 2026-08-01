import { describe, it, expect } from 'vitest';

/**
 * A caller may LOWER the surface's turn ceiling, never raise it.
 *
 * The surface value is a policy. If a request could raise it, any caller could
 * opt out of that policy — so the clamp is `Math.min`, not `??`. Lowering is
 * what a bounded run needs: an eval sample ran 124 tool calls over 66 minutes
 * and cost $6.58 entirely within the code surface's 200-turn budget. The ceiling
 * existed; there was no way to ask for a smaller one.
 */
function clamp(requested: unknown, surface: number | undefined): number | undefined {
  return typeof requested === 'number' && requested > 0
    ? Math.min(requested, surface ?? requested)
    : surface;
}

describe('maxTurns clamp', () => {
  it('honours a lower request', () => {
    expect(clamp(30, 200)).toBe(30);
  });

  it('refuses to raise the surface ceiling', () => {
    expect(clamp(5000, 200), 'a caller escaped the surface policy').toBe(200);
  });

  it('falls back to the surface value when nothing is requested', () => {
    expect(clamp(null, 200)).toBe(200);
    expect(clamp(undefined, 200)).toBe(200);
  });

  it('ignores nonsense rather than disabling the loop', () => {
    // 0 or negative would otherwise mean "no turns at all".
    expect(clamp(0, 200)).toBe(200);
    expect(clamp(-1, 200)).toBe(200);
    expect(clamp('30', 200)).toBe(200);
  });

  it('still bounds when the surface sets no ceiling of its own', () => {
    expect(clamp(30, undefined)).toBe(30);
  });
});
