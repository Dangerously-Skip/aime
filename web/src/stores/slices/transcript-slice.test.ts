import { describe, it, expect, vi } from 'vitest';
import { create } from 'zustand';
import { createTranscriptSlice, type TranscriptSlice, type TranscriptSliceOptions } from './transcript-slice';
import type { Message } from '@/stores/chat-store';

/**
 * The two behaviours that genuinely differ between surfaces are options on the
 * slice, so each is tested both ways here; the actions every store shares are
 * covered per store by message-stores.contract.test.ts and the store tests.
 */

const makeStore = (opts?: TranscriptSliceOptions) =>
  create<TranscriptSlice>()((set) => createTranscriptSlice(set, opts));

const turn = (): Message[] => [
  { id: 'u', role: 'user', content: 'go', timestamp: 1 },
  {
    id: 'a',
    role: 'assistant',
    content: 'working',
    timestamp: 2,
    isStreaming: true,
    isLoading: true,
    toolCalls: [{ id: 't', name: 'Read', input: {}, status: 'running', startTime: 3 }],
  },
];

describe('startStreaming', () => {
  it('selects the conversation only when asked to', () => {
    const selecting = makeStore({ selectOnStart: true });
    selecting.getState().startStreaming('c1');
    expect(selecting.getState().currentChatId).toBe('c1');

    const staying = makeStore();
    staying.getState().setCurrentChat('other');
    staying.getState().startStreaming('c1');
    expect(staying.getState().currentChatId).toBe('other');
    expect(staying.getState().streamingChats).toEqual({ c1: true });
  });

  it('runs onStart with the conversation, and not for an empty id', () => {
    const onStart = vi.fn();
    const store = makeStore({ onStart });
    store.getState().startStreaming('c1');
    store.getState().startStreaming('');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith('c1');
  });
});

describe('completeRunningTools', () => {
  it('ends the reply too when the surface says finishing tools does', () => {
    const store = makeStore({ finishingToolsEndsReply: true });
    store.setState({ messages: { c: turn() } });
    store.getState().completeRunningTools('c');
    const last = store.getState().messages.c[1];
    expect(last.toolCalls![0].status).toBe('complete');
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
  });

  it('otherwise leaves the reply streaming — text resumes after a tool', () => {
    const store = makeStore();
    store.setState({ messages: { c: turn() } });
    store.getState().completeRunningTools('c');
    const last = store.getState().messages.c[1];
    expect(last.toolCalls![0].status).toBe('complete');
    expect(last.isStreaming).toBe(true);
  });

  it('returns the same state when nothing is running, so text chunks do not re-render', () => {
    const store = makeStore();
    store.setState({ messages: { c: turn() } });
    store.getState().completeRunningTools('c');
    const before = store.getState().messages;
    store.getState().completeRunningTools('c');
    expect(store.getState().messages).toBe(before);
  });
});

describe('the reply-level reducers', () => {
  it('appending output clears a pending retry status', () => {
    const store = makeStore();
    store.setState({ messages: { c: turn() } });
    store.getState().setRetryStatus('c', { attempt: 2, delayMs: 1000 });
    expect(store.getState().messages.c[1].retrying).toEqual({ attempt: 2, delayMs: 1000 });
    store.getState().appendToLastAssistant('c', '!');
    expect(store.getState().messages.c[1].retrying).toBeUndefined();
    expect(store.getState().messages.c[1].content).toBe('working!');
  });

  it('truncates after, or from, a message', () => {
    const store = makeStore();
    store.setState({ messages: { c: turn() } });
    store.getState().truncateMessages('c', 'u');
    expect(store.getState().messages.c.map((m) => m.id)).toEqual(['u']);
    store.getState().truncateMessages('c', 'u', { inclusive: true });
    expect(store.getState().messages.c).toEqual([]);
  });

  it('attaches an inline canvas only to an assistant reply', () => {
    const store = makeStore();
    store.setState({ messages: { c: [turn()[0]] } });
    const before = store.getState().messages;
    store.getState().attachCanvasToLastAssistant('c', { id: 'x', title: 'X', doc: {} as never });
    expect(store.getState().messages).toBe(before);
  });
});
