// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createThrottledJSONStorage, isQuotaError } from './throttled-storage';
import { useChatStore } from '@/stores/chat-store';
import { openStorageGate } from '@/lib/gated-storage';

function memoryStorage() {
  const data = new Map<string, string>();
  const setItem = vi.fn((k: string, v: string) => { data.set(k, v); });
  return {
    data,
    setItem,
    storage: {
      get length() { return data.size; },
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem,
      removeItem: (k: string) => { data.delete(k); },
    } as Storage,
  };
}

const value = (n: number) => ({ state: { n }, version: 0 });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottledJSONStorage', () => {
  it('writes straight through when nothing is streaming', () => {
    const m = memoryStorage();
    const s = createThrottledJSONStorage<{ n: number }>(() => m.storage, { isBusy: () => false });
    s.setItem('k', value(1));
    s.setItem('k', value(2));
    expect(m.setItem).toHaveBeenCalledTimes(2);
    expect(s.getItem('k')).toEqual(value(2));
  });

  it('while streaming, coalesces to at most one write per interval, always the latest value', () => {
    const m = memoryStorage();
    let busy = true;
    const s = createThrottledJSONStorage<{ n: number }>(() => m.storage, { isBusy: () => busy, intervalMs: 2000 });

    for (let i = 1; i <= 100; i++) {
      s.setItem('k', value(i));
      vi.advanceTimersByTime(10); // a token every 10ms for a second
    }
    // One write for the whole second, not a hundred.
    expect(m.setItem.mock.calls.length).toBeLessThanOrEqual(1);

    vi.advanceTimersByTime(2000);
    expect(m.setItem.mock.calls.length).toBeLessThanOrEqual(2);
    expect(JSON.parse(m.data.get('k')!).state.n).toBe(100);

    // The turn ends: that write goes through at once.
    busy = false;
    s.setItem('k', value(101));
    expect(JSON.parse(m.data.get('k')!).state.n).toBe(101);
  });

  it('a full disk does not throw into the caller, and is reported once', () => {
    const m = memoryStorage();
    m.setItem.mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const onQuotaExceeded = vi.fn();
    const s = createThrottledJSONStorage<{ n: number }>(() => m.storage, { isBusy: () => false, onQuotaExceeded });
    expect(() => s.setItem('k', value(1))).not.toThrow();
    expect(onQuotaExceeded).toHaveBeenCalledWith('k', expect.anything());
  });

  it('recognises quota errors across engines', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
  });
});

describe('the chat store under a streaming reply', () => {
  it('does not rewrite localStorage per token, persists the finished turn, and survives a full disk', () => {
    const m = memoryStorage();
    vi.stubGlobal('localStorage', m.storage);
    openStorageGate();
    useChatStore.setState({ messages: {}, streamingChats: {}, isStreaming: false });
    m.setItem.mockClear();

    const st = useChatStore.getState();
    st.addMessage('c', { id: 'a', role: 'assistant', content: '', timestamp: 0, isStreaming: true });
    st.startStreaming('c');
    const writesAtStart = m.setItem.mock.calls.length;
    for (let i = 0; i < 200; i++) useChatStore.getState().appendToLastAssistant('c', 'x');
    expect(m.setItem.mock.calls.length - writesAtStart).toBeLessThanOrEqual(1);

    useChatStore.getState().stopStreaming('c');
    const saved = JSON.parse(m.data.get('aime:chat')!);
    expect(saved.state.messages.c[0].content).toHaveLength(200);

    // The disk fills up: the transcript in memory is untouched and appending keeps working.
    m.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => useChatStore.getState().appendToLastAssistant('c', 'y')).not.toThrow();
    expect(useChatStore.getState().messages.c[0].content).toHaveLength(201);
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});
