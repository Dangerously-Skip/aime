import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getModel,
  getProvider,
  modelsForCapability,
  resolveRoute,
  createDefaultRegistry,
  envAvailability,
  type AvailabilityFn,
} from './registry';
import type { Model, ModelProvider, ModelRegistry } from './types';

const provider = (id: string, overrides: Partial<ModelProvider> = {}): ModelProvider => ({
  id,
  label: id,
  kind: 'anthropic',
  ...overrides,
});

const model = (id: string, providerId: string, overrides: Partial<Model> = {}): Model => ({
  id,
  providerId,
  label: id,
  capabilities: ['chat'],
  driverModel: id,
  agentCapable: true,
  ...overrides,
});

/** A small hand-built registry: two providers, three chat models across tiers. */
function fixture(): ModelRegistry {
  return {
    providers: [provider('p-primary'), provider('p-fallback')],
    models: [
      model('smart-primary', 'p-primary'),
      model('smart-backup', 'p-fallback'),
      model('good-model', 'p-primary'),
      model('cheap-model', 'p-fallback'),
    ],
    routing: {
      chat: {
        smort: ['smart-primary', 'smart-backup'],
        good: ['good-model'],
        cheap: ['cheap-model'],
      },
    },
  };
}

const allAvailable: AvailabilityFn = () => true;
const noneAvailable: AvailabilityFn = () => false;
const availableExcept = (...ids: string[]): AvailabilityFn => (p) => !ids.includes(p.id);

describe('lookups', () => {
  const reg = fixture();
  it('getModel / getProvider find by id', () => {
    expect(getModel(reg, 'good-model')?.label).toBe('good-model');
    expect(getModel(reg, 'nope')).toBeUndefined();
    expect(getProvider(reg, 'p-primary')?.id).toBe('p-primary');
  });

  it('modelsForCapability filters by capability', () => {
    const withImage = { ...reg, models: [...reg.models, model('img', 'p-primary', { capabilities: ['image'] })] };
    expect(modelsForCapability(withImage, 'chat').map((m) => m.id)).not.toContain('img');
    expect(modelsForCapability(withImage, 'image').map((m) => m.id)).toEqual(['img']);
  });
});

describe('resolveRoute', () => {
  it('returns the primary candidate when its provider is available', () => {
    const r = resolveRoute(fixture(), 'chat', 'smort', allAvailable);
    expect(r?.model.id).toBe('smart-primary');
    expect(r?.tier).toBe('smort');
    expect(r?.degraded).toBe(false);
  });

  it('falls through to the next same-tier candidate and marks degraded', () => {
    const r = resolveRoute(fixture(), 'chat', 'smort', availableExcept('p-primary'));
    // smart-primary is on p-primary (unavailable) → smart-backup on p-fallback
    expect(r?.model.id).toBe('smart-backup');
    expect(r?.tier).toBe('smort');
    expect(r?.degraded).toBe(true);
  });

  it('tier-tumbles downward (smort → good → cheap) when a whole tier is unavailable', () => {
    // Only p-fallback available: smort has smart-backup on p-fallback, so it
    // resolves there first. Remove p-fallback's smort entry to force a tumble.
    const reg = fixture();
    reg.routing.chat!.smort = ['smart-primary']; // only on p-primary
    const r = resolveRoute(reg, 'chat', 'smort', availableExcept('p-primary'));
    // smort unavailable → good (good-model on p-primary, unavailable) → cheap (cheap-model on p-fallback)
    expect(r?.model.id).toBe('cheap-model');
    expect(r?.tier).toBe('cheap');
    expect(r?.degraded).toBe(true);
  });

  it('does not tumble below the requested tier when allowTierDegrade is false', () => {
    const reg = fixture();
    reg.routing.chat!.smort = ['smart-primary'];
    const r = resolveRoute(reg, 'chat', 'smort', availableExcept('p-primary'), { allowTierDegrade: false });
    expect(r).toBeNull();
  });

  it('does not tumble upward — a cheap request never returns a smort model', () => {
    const r = resolveRoute(fixture(), 'chat', 'cheap', allAvailable);
    expect(r?.model.id).toBe('cheap-model');
    expect(r?.tier).toBe('cheap');
  });

  it('returns null when nothing is available', () => {
    expect(resolveRoute(fixture(), 'chat', 'smort', noneAvailable)).toBeNull();
  });

  it('returns null for a capability with no routing', () => {
    expect(resolveRoute(fixture(), 'image', 'good', allAvailable)).toBeNull();
  });

  it('skips candidate ids that reference missing models or providers', () => {
    const reg = fixture();
    reg.routing.chat!.good = ['ghost-model', 'good-model'];
    const r = resolveRoute(reg, 'chat', 'good', allAvailable);
    expect(r?.model.id).toBe('good-model');
    expect(r?.degraded).toBe(true); // ghost skipped, good-model was index 1
  });
});

describe('default registry', () => {
  const reg = createDefaultRegistry();

  it('reproduces today: opus=smort, sonnet=good, haiku=cheap for chat + code', () => {
    for (const cap of ['chat', 'code'] as const) {
      expect(resolveRoute(reg, cap, 'smort', allAvailable)?.model.driverModel).toBe('opus');
      expect(resolveRoute(reg, cap, 'good', allAvailable)?.model.driverModel).toBe('sonnet');
      expect(resolveRoute(reg, cap, 'cheap', allAvailable)?.model.driverModel).toBe('haiku');
    }
  });

  it('routes code stallion to Fable', () => {
    const r = resolveRoute(reg, 'code', 'stallion', allAvailable);
    expect(r?.model.driverModel).toBe('claude-fable-5');
    expect(r?.tier).toBe('stallion');
    expect(r?.degraded).toBe(false);
  });

  it('stallion falls back to opus within-tier when Fable is unavailable', () => {
    // Fable and Opus are both on the anthropic provider here, so simulate a
    // model-level outage by pointing Fable at a missing provider.
    const custom = createDefaultRegistry();
    custom.models.find((m) => m.id === 'claude-fable')!.providerId = 'ghost';
    const r = resolveRoute(custom, 'code', 'stallion', allAvailable);
    expect(r?.model.driverModel).toBe('opus');
    expect(r?.degraded).toBe(true);
  });

  it('a chat stallion request tumbles down to smort (no chat stallion tier)', () => {
    const r = resolveRoute(reg, 'chat', 'stallion', allAvailable);
    expect(r?.model.driverModel).toBe('opus');
    expect(r?.tier).toBe('smort');
    expect(r?.degraded).toBe(true);
  });

  it('every model routed to chat/code is agentCapable (Agent SDK constraint)', () => {
    for (const cap of ['chat', 'code'] as const) {
      for (const tierModels of Object.values(reg.routing[cap] ?? {})) {
        for (const id of tierModels ?? []) {
          expect(getModel(reg, id)?.agentCapable, `${id} must be agentCapable`).toBe(true);
        }
      }
    }
  });

  it('every routed model id exists and points at a real provider', () => {
    for (const byTier of Object.values(reg.routing)) {
      for (const ids of Object.values(byTier ?? {})) {
        for (const id of ids ?? []) {
          const m = getModel(reg, id);
          expect(m, `model ${id}`).toBeDefined();
          expect(getProvider(reg, m!.providerId), `provider for ${id}`).toBeDefined();
        }
      }
    }
  });

  it('returns independent copies (no shared mutable state)', () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    a.routing.chat!.smort = ['claude-haiku'];
    expect(b.routing.chat!.smort).toEqual(['claude-opus', 'claude-sonnet']);
  });
});

describe('envAvailability', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is true when any credential env var is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(envAvailability({ id: 'anthropic', label: '', kind: 'anthropic', credentialEnv: ['ANTHROPIC_API_KEY'] })).toBe(false);
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-x');
    expect(envAvailability({ id: 'anthropic', label: '', kind: 'anthropic', credentialEnv: ['ANTHROPIC_API_KEY'] })).toBe(true);
  });

  it('treats a provider with no credentialEnv as always available', () => {
    expect(envAvailability({ id: 'local', label: '', kind: 'local' })).toBe(true);
  });

  it('resolves the default registry against real env (anthropic key gates chat)', () => {
    const reg = createDefaultRegistry();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-x');
    vi.stubEnv('AWS_REGION', '');
    vi.stubEnv('AWS_DEFAULT_REGION', '');
    expect(resolveRoute(reg, 'chat', 'smort', envAvailability)?.model.driverModel).toBe('opus');

    vi.stubEnv('ANTHROPIC_API_KEY', '');
    // No anthropic key, no bedrock region → all Claude providers unavailable
    expect(resolveRoute(reg, 'chat', 'smort', envAvailability)).toBeNull();
  });
});
