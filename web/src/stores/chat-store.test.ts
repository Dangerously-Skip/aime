import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore, type Message } from './chat-store';
import { notifyStreamAborted } from '@/lib/stream-registry';
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

describe('chat-store — aborted streams finalise the turn', () => {
  /** A turn caught mid-stream: streaming assistant bubble with a running tool. */
  const streamingTurn = (): Message[] => [
    { id: 'u', role: 'user', content: 'go', timestamp: 1 },
    {
      id: 'a',
      role: 'assistant',
      content: 'partial',
      timestamp: 2,
      isStreaming: true,
      isLoading: true,
      toolCalls: [{ id: 't', name: 'Read', input: {}, status: 'running', startTime: 3 }],
    },
  ];

  beforeEach(() => {
    useChatStore.setState({ messages: {}, isStreaming: false });
  });

  it('clears message-level streaming flags and running tools', () => {
    useChatStore.setState({ messages: { c1: streamingTurn() }, isStreaming: true });

    notifyStreamAborted({ chatId: 'c1', reason: 'user' });

    const last = useChatStore.getState().messages['c1'].at(-1)!;
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(last.toolCalls![0].status).toBe('complete');
    expect(last.content).toBe('partial'); // no error text invented
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('ignores a chatId that belongs to another surface store', () => {
    useChatStore.setState({ messages: { c1: streamingTurn() }, isStreaming: true });

    notifyStreamAborted({ chatId: 'a-cowork-conversation', reason: 'timeout' });

    // Chat is mid-stream on its own conversation: neither its composer flag nor
    // its message flags may be touched by another surface's abort.
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(useChatStore.getState().messages['c1'].at(-1)!.isStreaming).toBe(true);
  });
});
