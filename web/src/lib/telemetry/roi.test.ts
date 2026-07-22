import { describe, it, expect } from 'vitest';
import { calcROI } from './roi';

describe('calcROI', () => {
  it('computes multiplier as human hours over agent hours', () => {
    // 2 human hours vs 30 agent minutes → 4x
    const result = calcROI(2, 1, 30 * 60_000, 100);
    expect(result.multiplier).toBe(4);
  });

  it('computes dollars saved as human cost minus agent cost', () => {
    // 2h × $100 = $200 human cost − $5 agent cost = $195
    const result = calcROI(2, 5, 60 * 60_000, 100);
    expect(result.dollarsSaved).toBe(195);
  });

  it('rounds multiplier to one decimal place', () => {
    // 1 human hour vs 18 agent minutes = 3.333… → 3.3
    const result = calcROI(1, 0, 18 * 60_000, 100);
    expect(result.multiplier).toBe(3.3);
  });

  it('rounds dollars saved to cents', () => {
    const result = calcROI(1, 0.333, 60 * 60_000, 99.999);
    expect(result.dollarsSaved).toBe(99.67);
  });

  it('guards against zero duration instead of dividing by zero', () => {
    const result = calcROI(1, 0, 0, 100);
    expect(Number.isFinite(result.multiplier)).toBe(true);
    expect(result.multiplier).toBe(1000); // 1 / 0.001 floor
  });

  it('reports negative savings when the agent cost exceeds human cost', () => {
    const result = calcROI(0.1, 50, 60_000, 100);
    expect(result.dollarsSaved).toBe(-40);
  });
});
