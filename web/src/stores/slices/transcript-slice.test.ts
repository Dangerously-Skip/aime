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

/*
 * Retracting a refused reply's output by segment — the store half of the
 * Agent SDK 0.3 refusal fallback. The pipeline test
 * (claude-provider.refusal.test.ts) drives it from real provider output; these
 * pin the position arithmetic on its own.
 */
describe('segment retraction', () => {
  const tool = (id: string, textOffset: number) =>
    ({ id, name: 'Read', input: {}, status: 'complete' as const, startTime: 0, textOffset });

  function replyWith(content: string, marks: Record<string, number>, toolCalls = [] as ReturnType<typeof tool>[]) {
    const store = makeStore();
    store.setState({
      messages: {
        c: [
          { id: 'u', role: 'user', content: 'go', timestamp: 1 },
          { id: 'a', role: 'assistant', content, timestamp: 2, segmentMarks: marks, toolCalls },
        ],
      },
    });
    return store;
  }
  const reply = (store: ReturnType<typeof makeStore>) => store.getState().messages.c.at(-1)!;

  it('cuts a segment out of the middle and shifts what follows', () => {
    const store = replyWith('keepREFUSEDafter', { s1: 0, s2: 4, s3: 11 }, [tool('t1', 4), tool('t3', 16)]);
    store.getState().retractSegments('c', { segments: ['s2'], toolUseIds: [] });
    expect(reply(store).content).toBe('keepafter');
    expect(reply(store).toolCalls!.map((t) => [t.id, t.textOffset])).toEqual([['t1', 4], ['t3', 9]]);
    expect(reply(store).segmentMarks).toEqual({ s1: 0, s3: 4 });
  });

  it('removes several segments at once without the first cut corrupting the second', () => {
    const store = replyWith('aaBBccDDee', { s1: 0, s2: 2, s3: 4, s4: 6, s5: 8 }, [tool('t', 10)]);
    store.getState().retractSegments('c', { segments: ['s4', 's2'], toolUseIds: [] });
    expect(reply(store).content).toBe('aaccee');
    expect(reply(store).toolCalls![0].textOffset).toBe(6);
  });

  it('gives the text at a shared offset to the segment marked last — the earlier one had none', () => {
    // s1 opened with a tool call and no text; s2 started at the same offset.
    const keepEarlier = replyWith('xxREFUSED', { s0: 0, s1: 2, s2: 2 });
    keepEarlier.getState().retractSegments('c', { segments: ['s2'], toolUseIds: [] });
    expect(reply(keepEarlier).content).toBe('xx');

    const keepLater = replyWith('xxFALLBACK', { s0: 0, s1: 2, s2: 2 });
    keepLater.getState().retractSegments('c', { segments: ['s1'], toolUseIds: [] });
    expect(reply(keepLater).content).toBe('xxFALLBACK');
  });

  it('removes named tool calls and reports whether the reply now ends on one', () => {
    const store = replyWith('text', { s1: 0, s2: 4 }, [tool('kept', 4), tool('refused', 4)]);
    const { endsAfterTool } = store.getState().retractSegments('c', { segments: ['s2'], toolUseIds: ['refused'] });
    expect(reply(store).toolCalls!.map((t) => t.id)).toEqual(['kept']);
    expect(endsAfterTool).toBe(true);
  });

  it('never touches an earlier turn', () => {
    const store = makeStore();
    const earlier = { id: 'a0', role: 'assistant' as const, content: 'old', timestamp: 0, segmentMarks: { s1: 0 } };
    store.setState({
      messages: {
        c: [
          earlier,
          { id: 'u', role: 'user', content: 'go', timestamp: 1 },
          { id: 'a', role: 'assistant', content: 'new', timestamp: 2, segmentMarks: { s1: 0 } },
        ],
      },
    });
    store.getState().retractSegments('c', { segments: ['s1'], toolUseIds: [] });
    expect(store.getState().messages.c[0]).toBe(earlier);
    expect(reply(store).content).toBe('');
  });

  it('is a no-op (same state object) when nothing matches', () => {
    const store = replyWith('text', { s1: 0 });
    const before = store.getState().messages;
    store.getState().retractSegments('c', { segments: ['nope'], toolUseIds: ['nope'] });
    expect(store.getState().messages).toBe(before);
  });

  it('marks a segment once, past the separator it is about to receive', () => {
    const store = replyWith('ab', {});
    store.getState().markSegment('c', 's9', 2);
    store.getState().appendToLastAssistant('c', '\n\nnext');
    store.getState().markSegment('c', 's9', 0);
    expect(reply(store).segmentMarks).toEqual({ s9: 4 });
  });

  it('forgets every mark when the turn stops — none is persisted', () => {
    const store = replyWith('ab', { s1: 0 });
    store.getState().stopStreaming('c');
    expect(reply(store).segmentMarks).toBeUndefined();
  });
});
