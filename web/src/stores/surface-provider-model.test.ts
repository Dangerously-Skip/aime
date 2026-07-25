import { describe, it, expect, beforeEach } from 'vitest';
import { useCodeStore } from './code-store';
import { useCoworkStore } from './cowork-store';
import type { ModelOption } from '@/lib/models/client-options';

const opt: ModelOption = {
  id: 'p1:m1',
  label: 'M1',
  group: 'P1',
  model: 'm1',
  providerConfig: { providerId: 'p1', transport: 'openai-compat', baseUrl: 'http://x/v1' },
};

/** The provider-model slice both surface stores share (typed narrowly so the
 *  parametrized suite can call it regardless of each store's full type). */
interface ProviderModelStore {
  getState: () => {
    model: string;
    providerModel: ModelOption | null;
    setModel: (m: string) => void;
    setProviderModel: (o: ModelOption | null) => void;
  };
  setState: (patch: { providerModel: ModelOption | null }) => void;
}

// Both surface stores mirror chat-store's provider-model override behaviour.
describe.each([
  ['code', useCodeStore as unknown as ProviderModelStore],
  ['cowork', useCoworkStore as unknown as ProviderModelStore],
])('%s-store provider-model override', (_name, useStore) => {
  beforeEach(() => useStore.setState({ providerModel: null }));

  it('records a provider selection without touching the built-in enum', () => {
    const before = useStore.getState().model;
    useStore.getState().setProviderModel(opt);
    expect(useStore.getState().providerModel).toEqual(opt);
    expect(useStore.getState().model).toBe(before);
  });

  it('clears the override when a valid built-in model is selected', () => {
    useStore.getState().setProviderModel(opt);
    useStore.getState().setModel('opus');
    expect(useStore.getState().model).toBe('opus');
    expect(useStore.getState().providerModel).toBeNull();
  });
});
