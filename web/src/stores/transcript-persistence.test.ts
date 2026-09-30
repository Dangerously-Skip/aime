// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryTranscriptBackend } from '@/lib/transcripts/backend';

/**
 * The real stores on the real persist path, with the transcript database
 * swapped for the in-memory implementation of its contract (jsdom has no
 * IndexedDB). What this proves that transcript-storage.test.ts cannot: the
 * four stores are actually wired to it, their own actions — a streamed turn,
 * the sidebar's delete and undo — produce the right writes, and an existing
 * user's localStorage history arrives intact through the real rehydrate,
 * migrations and dedupe included.
 */

const backend = createMemoryTranscriptBackend();
vi.mock('@/lib/transcripts/idb-backend', () => ({
  getTranscriptBackend: () => Promise.resolve(backend),
}));

const { useChatStore } = await import('./chat-store');
const { useCoworkStore } = await import('./cowork-store');
const { useCodeStore } = await import('./code-store');
const { useBrowserStore } = await import('./browser-store');
const { useConversationStore } = await import('./conversation-store');
const { openStorageGate } = await import('@/lib/gated-storage');
const { deleteConversation, restoreConversation } = await import('@/components/layout/sidebar-chats-actions');

const local = new Map<string, string>();
const msg = (id: string, role: 'user' | 'assistant' = 'assistant', content = id) => ({
  id,
  role,
  content,
  timestamp: 1,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', {
    get length() {
      return local.size;
    },
    clear: () => local.clear(),
    key: (i: number) => [...local.keys()][i] ?? null,
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  } satisfies Storage);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a returning user', () => {
  it('keeps every surface’s history through the move to the transcript database', async () => {
    local.set(
      'aime:chat',
      JSON.stringify({
        version: 0,
        state: {
          currentChatId: 'c1',
          // Stale flags and a duplicate id: the rehydrate cleanups still run.
          messages: { c1: [msg('u', 'user', 'hi'), msg('a', 'assistant', 'hello'), msg('a')].map((m) => ({ ...m, isStreaming: true })) },
          sessionControls: { c1: { verboseMode: true } },
        },
      }),
    );
    local.set('aime:cowork', JSON.stringify({ version: 1, state: { messages: { w1: [msg('w')] }, folderByChat: { w1: '/tmp/w' } } }));
    local.set('aime:code', JSON.stringify({ version: 0, state: { messages: { k1: [msg('k')] } } }));
    local.set('aime:browser', JSON.stringify({ version: 0, state: { messages: { b1: [msg('b')] } } }));

    await Promise.all([
      useChatStore.persist.rehydrate(),
      useCoworkStore.persist.rehydrate(),
      useCodeStore.persist.rehydrate(),
      useBrowserStore.persist.rehydrate(),
    ]);

    const chat = useChatStore.getState();
    expect(chat.messages.c1.map((m) => m.id)).toEqual(['u', 'a']);
    expect(chat.messages.c1.every((m) => !m.isStreaming)).toBe(true);
    expect(chat.sessionControls.c1.verboseMode).toBe(false); // v0 → v1 migration ran
    expect(chat.currentChatId).toBe('c1');
    expect(useCoworkStore.getState().messages.w1).toHaveLength(1);
    expect(useCoworkStore.getState().folderByChat.w1).toBe('/tmp/w');
    expect(useCodeStore.getState().messages.k1).toHaveLength(1);
    expect(useBrowserStore.getState().messages.b1).toHaveLength(1);

    for (const surface of ['chat', 'cowork', 'code', 'browser']) {
      expect(JSON.parse(local.get(`aime:${surface}`)!).state.messages, surface).toBeUndefined();
    }
    expect(Object.keys(await backend.loadSurface('chat'))).toEqual(['c1']);
    expect(Object.keys(await backend.loadSurface('browser'))).toEqual(['b1']);
  });
});

describe('after hydration', () => {
  beforeEach(() => openStorageGate());

  it('a streamed turn is written when it ends, not per token', async () => {
    const put = vi.spyOn(backend, 'put');
    const s = useCodeStore.getState();
    s.addMessage('k1', msg('q', 'user', 'refactor'));
    s.startStreaming('k1');
    s.addMessage('k1', { ...msg('r', 'assistant', ''), isStreaming: true });
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 100; i++) useCodeStore.getState().appendToLastAssistant('k1', 'x');
    await vi.advanceTimersByTimeAsync(5000);
    expect(put).not.toHaveBeenCalled();

    useCodeStore.getState().stopStreaming('k1');
    expect(put).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    const saved = (await backend.loadSurface('code')).k1 as Array<{ content: string }>;
    expect(saved.at(-1)!.content).toBe('x'.repeat(100));
    put.mockRestore();
  });

  it('deleting a conversation deletes its record, and undo puts it back', async () => {
    useConversationStore.setState({
      conversations: [{ id: 'w1', surface: 'cowork', title: 'T', lastMessage: '', createdAt: 1, updatedAt: 1 }],
    });
    const deleted = deleteConversation('w1')!;
    await vi.advanceTimersByTimeAsync(1000);
    expect((await backend.loadSurface('cowork')).w1).toBeUndefined();

    restoreConversation(deleted);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await backend.loadSurface('cowork')).w1).toHaveLength(1);
    expect(useCoworkStore.getState().messages.w1).toHaveLength(1);
  });
});
