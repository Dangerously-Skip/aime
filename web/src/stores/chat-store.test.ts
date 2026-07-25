import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat-store';
import type { ModelOption } from '@/lib/models/client-options';

const kimi: ModelOption = {
  id: 'openrouter-1:kimi',
  label: 'Kimi K2',
  group: 'OpenRouter',
  kind: 'model',
  model: 'moonshotai/kimi-k2',
  providerConfig: { providerId: 'openrouter-1', transport: 'anthropic-native', baseUrl: 'https://openrouter.ai/api/v1' },
};

describe('chat-store model-route override', () => {
  beforeEach(() => {
    useChatStore.setState({ model: 'sonnet', modelRoute: null });
  });

  it('setModelRoute records a route selection', () => {
    useChatStore.getState().setModelRoute(kimi);
    expect(useChatStore.getState().modelRoute).toEqual(kimi);
    // the built-in enum is untouched
    expect(useChatStore.getState().model).toBe('sonnet');
  });

  it('selecting a built-in model clears the provider override', () => {
    useChatStore.getState().setModelRoute(kimi);
    useChatStore.getState().setModel('opus');
    expect(useChatStore.getState().model).toBe('opus');
    expect(useChatStore.getState().modelRoute).toBeNull();
  });

  it('rejects an invalid built-in model without touching the override', () => {
    useChatStore.getState().setModelRoute(kimi);
    useChatStore.getState().setModel('not-a-model');
    expect(useChatStore.getState().model).toBe('sonnet');
    expect(useChatStore.getState().modelRoute).toEqual(kimi); // unchanged
  });
});
