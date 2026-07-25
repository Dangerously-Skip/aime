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
    model: string;
    modelRoute: ModelOption | null;
    setModel: (m: string) => void;
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

  it('records a route selection without touching the built-in enum', () => {
    const before = useStore.getState().model;
    useStore.getState().setModelRoute(opt);
    expect(useStore.getState().modelRoute).toEqual(opt);
    expect(useStore.getState().model).toBe(before);
  });

  it('clears the override when a valid built-in model is selected', () => {
    useStore.getState().setModelRoute(opt);
    useStore.getState().setModel('opus');
    expect(useStore.getState().model).toBe('opus');
    expect(useStore.getState().modelRoute).toBeNull();
  });
});
