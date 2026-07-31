import { describe, it, expect, beforeEach } from 'vitest';
import { useCodeStore } from './code-store';
import { useCoworkStore } from './cowork-store';
import type { ModelOption } from '@/lib/models/client-options';

const opt: ModelOption = {
  id: 'p1:m1',
  label: 'M1',
  group: 'P1',
  kind: 'model',
  model: 'm1',
  providerConfig: { providerId: 'p1', transport: 'openai-compat', baseUrl: 'http://x/v1' },
};

/** The model-route slice both surface stores share (typed narrowly so the
 *  parametrized suite can call it regardless of each store's full type). */
interface ModelRouteStore {
  getState: () => {
    modelRoute: ModelOption | null;
    setModelRoute: (o: ModelOption | null) => void;
  };
  setState: (patch: { modelRoute: ModelOption | null }) => void;
}

// Both surface stores mirror chat-store's model-route override behaviour.
describe.each([
  ['code', useCodeStore as unknown as ModelRouteStore],
  ['cowork', useCoworkStore as unknown as ModelRouteStore],
])('%s-store model-route override', (_name, useStore) => {
  beforeEach(() => useStore.setState({ modelRoute: null }));

  it('records a provider model as a route, carrying its providerConfig', () => {
    useStore.getState().setModelRoute(opt);
    expect(useStore.getState().modelRoute).toEqual(opt);
    // The providerConfig is what makes a BYOK model reachable at all — a route
    // that loses it silently falls back to the built-in Anthropic path.
    expect(useStore.getState().modelRoute?.providerConfig?.providerId).toBe('p1');
  });

  /**
   * There is no built-in model enum to fall back to any more, so "unset" is the
   * only way to say "follow Settings". Previously each store also carried a
   * hardcoded default (`sonnet`/`opus`), which meant a surface shipped pinned
   * and the user's tier grid never got a say.
   */
  it('clears back to unpinned rather than to a hardcoded default', () => {
    useStore.getState().setModelRoute(opt);
    useStore.getState().setModelRoute(null);
    expect(useStore.getState().modelRoute).toBeNull();
  });
});
