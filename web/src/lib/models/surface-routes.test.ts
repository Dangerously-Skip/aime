import { describe, it, expect } from 'vitest';
import { getSurfaceRoute, SURFACE_ROUTES, DEFAULT_SURFACE_ROUTE } from './surface-routes';
import { resolveRoute, createDefaultRegistry } from './registry';

describe('getSurfaceRoute', () => {
  it('returns each surface default', () => {
    expect(getSurfaceRoute('chat')).toEqual({ capability: 'chat', tier: 'good' });
    expect(getSurfaceRoute('cowork')).toEqual({ capability: 'code', tier: 'smort' });
    expect(getSurfaceRoute('code')).toEqual({ capability: 'code', tier: 'good' });
  });

  it('falls back to the default route for an unknown surface', () => {
    expect(getSurfaceRoute('brand-new-surface')).toEqual(DEFAULT_SURFACE_ROUTE);
  });

  it('applies a user tier override but never changes the capability', () => {
    const r = getSurfaceRoute('cowork', { cowork: 'cheap' });
    expect(r).toEqual({ capability: 'code', tier: 'cheap' });
  });

  it('ignores an override aimed at a different surface', () => {
    expect(getSurfaceRoute('chat', { cowork: 'cheap' })).toEqual(SURFACE_ROUTES.chat);
  });

  it('tolerates null/absent overrides', () => {
    expect(getSurfaceRoute('chat', null)).toEqual(SURFACE_ROUTES.chat);
    expect(getSurfaceRoute('chat', {})).toEqual(SURFACE_ROUTES.chat);
  });
});

// The whole point of the defaults is that they reproduce the previously
// hardcoded per-surface models — this is the no-behaviour-change guarantee.
describe('surface defaults resolve to the previous hardcoded models', () => {
  const reg = createDefaultRegistry();
  const all = () => true;
  const driverFor = (surfaceId: string) => {
    const { capability, tier } = getSurfaceRoute(surfaceId);
    return resolveRoute(reg, capability, tier, all)?.model.driverModel;
  };

  it.each([
    ['chat', 'sonnet'],
    ['browser', 'sonnet'],
    ['assistant', 'sonnet'],
    ['code', 'sonnet'],
    ['cowork', 'opus'], // cowork was the one premium surface
  ])('%s → %s', (surfaceId, expected) => {
    expect(driverFor(surfaceId)).toBe(expected);
  });

  /*
   * The model is the same either way on the default registry — which is what
   * makes the tests above pass whichever capability browser is on, and why the
   * capability needs pinning separately.
   *
   * It matters on a BYOK setup, where chat/good and code/good are two different
   * slots the user fills independently. Browser drives a browser, writes files
   * and reaches connectors now (DR-22); giving it whatever cheap conversational
   * model fills the chat slot is the wrong default.
   */
  it.each([
    ['browser', 'code'],
    ['code', 'code'],
    ['cowork', 'code'],
    ['chat', 'chat'],
    ['assistant', 'chat'],
  ])('%s asks for the %s capability', (surfaceId, capability) => {
    expect(getSurfaceRoute(surfaceId).capability).toBe(capability);
  });

  it('a stallion override on cowork reaches Fable', () => {
    const { capability, tier } = getSurfaceRoute('cowork', { cowork: 'stallion' });
    expect(resolveRoute(reg, capability, tier, all)?.model.driverModel).toBe('claude-fable-5');
  });
});
