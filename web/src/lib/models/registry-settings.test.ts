import { describe, it, expect } from 'vitest';
import { resolveWithSettings, warmthToTemperature, type AvailabilityFn } from './registry';
import type { Model, ModelProvider, ModelRegistry, RouteSettings } from './types';

const provider = (id: string): ModelProvider => ({ id, label: id, kind: 'anthropic' });
const model = (id: string, providerId: string, outputPer1kUsd: number | null): Model => ({
  id,
  providerId,
  label: id,
  capabilities: ['code'],
  driverModel: id,
  agentCapable: true,
  pricing: outputPer1kUsd == null ? undefined : { inputPer1kUsd: outputPer1kUsd / 3, outputPer1kUsd },
});

/** Four code tiers, each model on its own provider so availability is per-tier. */
function fixture(): ModelRegistry {
  return {
    providers: [provider('pStallion'), provider('pSmort'), provider('pGood'), provider('pCheap')],
    models: [
      model('m-stallion', 'pStallion', 0.05),
      model('m-smort', 'pSmort', 0.025),
      model('m-good', 'pGood', 0.015),
      model('m-cheap', 'pCheap', 0.005),
    ],
    routing: {
      code: { stallion: ['m-stallion'], smort: ['m-smort'], good: ['m-good'], cheap: ['m-cheap'] },
    },
  };
}

const all: AvailabilityFn = () => true;
const except = (...ids: string[]): AvailabilityFn => (p) => !ids.includes(p.id);
const resolve = (tier: Parameters<typeof resolveWithSettings>[2], settings?: RouteSettings, avail: AvailabilityFn = all) =>
  resolveWithSettings(fixture(), 'code', tier, avail, settings);

describe('warmthToTemperature', () => {
  it('maps and clamps warmth into [0, 1]', () => {
    expect(warmthToTemperature(0)).toBe(0);
    expect(warmthToTemperature(0.5)).toBe(0.5);
    expect(warmthToTemperature(1)).toBe(1);
    expect(warmthToTemperature(2)).toBe(1);
    expect(warmthToTemperature(-1)).toBe(0);
  });
});

describe('resolveWithSettings — defaults', () => {
  it('with no settings behaves like resolveRoute and yields no temperature', () => {
    const r = resolve('stallion')!;
    expect(r.route.model.id).toBe('m-stallion');
    expect(r.route.degraded).toBe(false);
    expect(r.temperature).toBeUndefined();
  });

  it('returns a temperature when warmth is set', () => {
    const r = resolve('good', { warmth: 0.3 })!;
    expect(r.temperature).toBe(0.3);
    expect(r.route.model.id).toBe('m-good');
  });

  it('returns null when nothing is available', () => {
    expect(resolve('good', {}, () => false)).toBeNull();
  });
});

describe('resolveWithSettings — maxTier clamp', () => {
  it('clamps a too-premium request down and marks it degraded', () => {
    const r = resolve('stallion', { maxTier: 'good' })!;
    expect(r.route.model.id).toBe('m-good');
    expect(r.route.tier).toBe('good');
    expect(r.route.degraded).toBe(true);
  });

  it('does not raise a request whose tier is already at or below the cap', () => {
    const r = resolve('cheap', { maxTier: 'stallion' })!;
    expect(r.route.model.id).toBe('m-cheap');
    expect(r.route.degraded).toBe(false);
  });
});

describe('resolveWithSettings — cost ceiling', () => {
  it('skips candidates over the ceiling and tumbles to an affordable one', () => {
    // ceiling 0.02 excludes stallion (0.05) and smort (0.025); good (0.015) passes.
    const r = resolve('stallion', { costCeilingPer1kUsd: 0.02 })!;
    expect(r.route.model.id).toBe('m-good');
    expect(r.route.degraded).toBe(true);
  });

  it('always allows an unpriced model', () => {
    const reg = fixture();
    reg.models.push(model('m-free', 'pStallion', null));
    reg.routing.code!.stallion = ['m-free', 'm-stallion'];
    const r = resolveWithSettings(reg, 'code', 'stallion', all, { costCeilingPer1kUsd: 0.001 })!;
    expect(r.route.model.id).toBe('m-free');
    expect(r.route.degraded).toBe(false);
  });
});

describe('resolveWithSettings — explicit tumble chains', () => {
  it('uses the primary slot when available, ignoring the chain', () => {
    const settings: RouteSettings = { tumbleChains: { 'code:stallion': [{ capability: 'code', tier: 'cheap' }] } };
    const r = resolve('stallion', settings)!;
    expect(r.route.model.id).toBe('m-stallion');
    expect(r.route.degraded).toBe(false);
  });

  it('follows the chain (not the default tumble) when the primary is unavailable', () => {
    // Chain jumps stallion → cheap, deliberately skipping smort/good even though
    // they are available; the default tumble would have picked smort.
    const settings: RouteSettings = { tumbleChains: { 'code:stallion': [{ capability: 'code', tier: 'cheap' }] } };
    const r = resolve('stallion', settings, except('pStallion'))!;
    expect(r.route.model.id).toBe('m-cheap');
    expect(r.route.tier).toBe('cheap');
    expect(r.route.degraded).toBe(true);
  });

  it('returns null when neither the primary nor any chain slot resolves', () => {
    const settings: RouteSettings = { tumbleChains: { 'code:stallion': [{ capability: 'code', tier: 'good' }] } };
    const r = resolve('stallion', settings, except('pStallion', 'pGood'));
    expect(r).toBeNull();
  });
});
