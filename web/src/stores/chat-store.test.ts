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
    useChatStore.setState({ modelRoute: null });
  });

  /**
   * There is no built-in model enum on the store any more. Every selection —
   * tier, built-in, or a user provider's model — is recorded as ONE route, so
   * an unset route genuinely means "whatever Settings resolves to" instead of a
   * hardcoded default the user never chose. That default is what made surfaces
   * ignore the tier grid.
   */
  it('records any selection as a route', () => {
    useChatStore.getState().setModelRoute(kimi);
    expect(useChatStore.getState().modelRoute).toEqual(kimi);
  });

  it('clears back to unpinned, which means "follow Settings"', () => {
    useChatStore.getState().setModelRoute(kimi);
    useChatStore.getState().setModelRoute(null);
    expect(useChatStore.getState().modelRoute).toBeNull();
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
