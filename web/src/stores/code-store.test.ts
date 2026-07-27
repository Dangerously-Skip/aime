import { describe, it, expect, beforeEach } from 'vitest';
import { useCodeStore } from './code-store';
import { notifyStreamAborted } from '@/lib/stream-registry';
import type { Message } from './chat-store';

const streamingTurn = (): Message[] => [
  { id: 'u', role: 'user', content: 'refactor it', timestamp: 1 },
  {
    id: 'a',
    role: 'assistant',
    content: 'working',
    timestamp: 2,
    isStreaming: true,
    isLoading: true,
    toolCalls: [{ id: 't', name: 'Edit', input: {}, status: 'running', startTime: 3 }],
  },
];

const store = () => useCodeStore.getState();

beforeEach(() => {
  useCodeStore.setState({ messages: {}, currentChatId: null, isStreaming: false });
});

describe('code-store streaming lifecycle', () => {
  it('stopStreaming clears the flags on the last message', () => {
    useCodeStore.setState({ messages: { c: streamingTurn() }, isStreaming: true });

    store().stopStreaming('c');

    const last = store().messages['c'].at(-1)!;
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(store().isStreaming).toBe(false);
  });

  it('an aborted stream finalises the turn without inventing an error', () => {
    useCodeStore.setState({ messages: { c: streamingTurn() }, isStreaming: true });

    notifyStreamAborted({ chatId: 'c', reason: 'user' });

    const last = store().messages['c'].at(-1)!;
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(last.toolCalls![0].status).toBe('complete');
    expect(last.content).toBe('working');
    expect(store().isStreaming).toBe(false);
  });

  it('an aborted stream in another surface leaves code alone', () => {
    useCodeStore.setState({ messages: { c: streamingTurn() }, isStreaming: true });

    notifyStreamAborted({ chatId: 'a-cowork-conversation', reason: 'user' });

    expect(store().messages['c'].at(-1)!.isStreaming).toBe(true);
    expect(store().isStreaming).toBe(true);
  });
});
