// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMemoryTranscriptBackend, type Transcript, type TranscriptBackend } from './backend';
import { createTranscriptStorage, clearAllTranscripts, type TranscriptStorageOptions } from './transcript-storage';

/**
 * Driven through a REAL zustand `persist` store: the thing that has to hold is
 * that `persist.rehydrate()` and ordinary `set` calls do the right thing to the
 * two stores underneath, and a hand-called getItem/setItem would only prove the
 * storage agrees with itself. The backend is the in-memory implementation of
 * the same contract the IndexedDB wrapper implements (idb-backend.test.ts
 * covers that one).
 */

type Msg = { id: string; role: string; content: string };
interface State {
  messages: Record<string, Msg[]>;
  streamingChats: Record<string, true>;
  folder: string;
}

const NAME = 'aime:test';
const msg = (id: string, content = id): Msg => ({ id, role: 'assistant', content });

function memoryStorage() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: (k: string) => void data.delete(k),
  };
  return { data, storage: storage as Storage & { setItem: ReturnType<typeof vi.fn> } };
}

const blob = (local: ReturnType<typeof memoryStorage>) => JSON.parse(local.data.get(NAME) ?? 'null');

function setup(
  over: Partial<Omit<TranscriptStorageOptions, 'backend' | 'local'>> & {
    /** `null`: no IndexedDB at all. */
    backend?: (TranscriptBackend & { records?: Map<string, Transcript> }) | null;
    local?: ReturnType<typeof memoryStorage>;
  } = {},
) {
  const { backend: givenBackend, local: givenLocal, ...rest } = over;
  const backend = givenBackend ?? createMemoryTranscriptBackend();
  const local = givenLocal ?? memoryStorage();
  const put = vi.spyOn(backend, 'put');
  const remove = vi.spyOn(backend, 'remove');
  let gate = true;
  const storage = createTranscriptStorage<{ messages: Record<string, Msg[]>; folder: string }>({
    surface: 's',
    local: () => local.storage,
    rawLocal: () => local.storage,
    backend: givenBackend === null ? async () => null : async () => backend,
    isBusy: (): boolean => Object.keys(useStore.getState().streamingChats).length > 0,
    isStreaming: (id): boolean => !!useStore.getState().streamingChats[id],
    canWrite: () => gate,
    debounceMs: 1000,
    checkpointMs: 30_000,
    ...rest,
  });
  const useStore = create<State>()(
    persist(
      () => ({ messages: {}, streamingChats: {}, folder: '' }),
      {
        name: NAME,
        storage,
        partialize: (s) => ({ messages: s.messages, folder: s.folder }),
        skipHydration: true,
        version: 1,
      },
    ),
  );
  const setMessages = (id: string, msgs: Msg[] | undefined) =>
    useStore.setState((s) => {
      const next = { ...s.messages };
      if (msgs) next[id] = msgs;
      else delete next[id];
      return { messages: next };
    });
  return {
    backend,
    local,
    storage,
    useStore,
    put,
    remove,
    setMessages,
    closeGate: () => void (gate = false),
    openGate: () => void (gate = true),
  };
}

function seedLegacy(local: ReturnType<typeof memoryStorage>, messages: Record<string, Msg[]>) {
  local.data.set(NAME, JSON.stringify({ state: { messages, folder: '/work' }, version: 1 }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('migrating transcripts out of localStorage', () => {
  it('moves them into the backend, verifies, and only then drops them from localStorage', async () => {
    const t = setup();
    seedLegacy(t.local, { a: [msg('a1'), msg('a2')], b: [msg('b1')] });

    await t.useStore.persist.rehydrate();

    expect(t.storage.mode()).toBe('idb');
    expect(t.useStore.getState().messages.a.map((m) => m.id)).toEqual(['a1', 'a2']);
    expect(t.useStore.getState().folder).toBe('/work');
    expect(Object.keys(await t.backend.loadSurface('s')).sort()).toEqual(['a', 'b']);
    // The small state survives; the transcripts are gone from localStorage.
    expect(blob(t.local)).toEqual({ state: { folder: '/work' }, version: 1 });
  });

  it('a crash between the write and the removal loses nothing and finishes next launch', async () => {
    const local = memoryStorage();
    const backend = createMemoryTranscriptBackend();
    seedLegacy(local, { a: [msg('a1')], b: [msg('b1')] });

    // Launch 1 dies at the moment it would rewrite localStorage.
    const crashed = setup({
      local,
      backend,
      rawLocal: () => ({ ...local.storage, setItem: () => { throw new Error('renderer killed'); } }),
    });
    await crashed.useStore.persist.rehydrate();
    expect(blob(local).state.messages.a).toHaveLength(1); // still there
    expect(backend.records.size).toBe(2); // and already copied

    // Launch 2 runs the same migration again over the same data.
    const next = setup({ local, backend });
    await next.useStore.persist.rehydrate();
    expect(blob(local).state.messages).toBeUndefined();
    expect(backend.records.size).toBe(2);
    expect(next.useStore.getState().messages.b[0].id).toBe('b1');
  });

  it('never removes anything from localStorage when the copy fails', async () => {
    const backend = createMemoryTranscriptBackend();
    backend.putMany = () => Promise.reject(new DOMException('full', 'QuotaExceededError'));
    const t = setup({ backend });
    seedLegacy(t.local, { a: [msg('a1')] });

    await t.useStore.persist.rehydrate();

    expect(t.storage.mode()).toBe('local');
    expect(blob(t.local).state.messages.a).toHaveLength(1);
    expect(t.useStore.getState().messages.a).toHaveLength(1);
  });

  it('never removes anything when the copy does not read back intact', async () => {
    const backend = createMemoryTranscriptBackend();
    const realLoad = backend.loadSurface;
    backend.loadSurface = async (s) => {
      const all = await realLoad(s);
      return { ...all, a: all.a?.slice(0, 1) as Transcript };
    };
    const t = setup({ backend });
    seedLegacy(t.local, { a: [msg('a1'), msg('a2')] });

    await t.useStore.persist.rehydrate();

    expect(t.storage.mode()).toBe('local');
    expect(blob(t.local).state.messages.a).toHaveLength(2);
  });

  it('a conversation localStorage still holds wins over the backend copy', async () => {
    // It can only be there if the backend was not being written — a session
    // that fell back — so it is the newer of the two.
    const t = setup();
    await t.backend.put('s', 'a', [msg('old')]);
    await t.backend.put('s', 'kept', [msg('k')]);
    seedLegacy(t.local, { a: [msg('new')] });

    await t.useStore.persist.rehydrate();

    expect(t.useStore.getState().messages.a[0].id).toBe('new');
    expect(t.useStore.getState().messages.kept[0].id).toBe('k');
  });
});

describe('without IndexedDB', () => {
  it('runs on localStorage exactly as before, transcripts included', async () => {
    const t = setup({ backend: null });
    seedLegacy(t.local, { a: [msg('a1')] });
    await t.useStore.persist.rehydrate();
    expect(t.storage.mode()).toBe('local');
    expect(t.useStore.getState().messages.a).toHaveLength(1);

    t.setMessages('a', [msg('a1'), msg('a2')]);
    expect(blob(t.local).state.messages.a).toHaveLength(2);
  });
});

describe('writing', () => {
  async function hydrated(seed: Record<string, Msg[]> = { a: [msg('a1')], b: [msg('b1')] }) {
    const t = setup();
    for (const [id, m] of Object.entries(seed)) await t.backend.put('s', id, m);
    await t.useStore.persist.rehydrate();
    t.put.mockClear();
    return t;
  }

  it('hydrating writes nothing back', async () => {
    const t = await hydrated();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.put).not.toHaveBeenCalled();
  });

  it('a change writes that conversation only, once, after the debounce', async () => {
    const t = await hydrated();
    t.setMessages('a', [msg('a1'), msg('a2')]);
    t.setMessages('a', [msg('a1'), msg('a2'), msg('a3')]);
    expect(t.put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(t.put).toHaveBeenCalledTimes(1);
    expect(t.put).toHaveBeenCalledWith('s', 'a', expect.any(Array));
    expect((await t.backend.loadSurface('s')).a).toHaveLength(3);
    // And localStorage carries no transcript at all.
    expect(blob(t.local).state.messages).toBeUndefined();
  });

  it('does not write a conversation mid-turn, and writes it the moment the turn ends', async () => {
    const t = await hydrated();
    t.useStore.setState({ streamingChats: { a: true } });
    let content = '';
    for (let i = 0; i < 200; i++) {
      content += 'x';
      t.setMessages('a', [msg('a1'), msg('a2', content)]);
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(t.put).not.toHaveBeenCalled();

    // Another conversation changing meanwhile is still written on its own schedule.
    t.setMessages('b', [msg('b1'), msg('b2')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.put.mock.calls.map((c) => c[1])).toEqual(['b']);

    // Turn ends: written at once, not a debounce later.
    t.useStore.setState({ streamingChats: {} });
    expect(t.put.mock.calls.map((c) => c[1])).toEqual(['b', 'a']);
    await t.storage.flush();
    expect((await t.backend.loadSurface('s')).a[1]).toMatchObject({ content: 'x'.repeat(200) });
  });

  it('checkpoints a long turn so a crash cannot take all of it', async () => {
    const t = await hydrated();
    t.useStore.setState({ streamingChats: { a: true } });
    t.setMessages('a', [msg('a1'), msg('a2', 'partial')]);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(t.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.put).toHaveBeenCalledTimes(1);
  });

  it('flushes pending writes when the page goes away', async () => {
    const t = await hydrated();
    t.useStore.setState({ streamingChats: { a: true } });
    t.setMessages('a', [msg('a1'), msg('a2')]);
    t.setMessages('b', [msg('b1'), msg('b2')]);
    window.dispatchEvent(new Event('pagehide'));
    expect(t.put.mock.calls.map((c) => c[1]).sort()).toEqual(['a', 'b']);
  });

  it('writes nothing while the storage gate is shut, and catches up once it opens', async () => {
    const t = await hydrated();
    t.closeGate();
    t.setMessages('a', [msg('a1'), msg('a2')]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.put).not.toHaveBeenCalled();

    t.openGate();
    t.useStore.setState({ folder: '/elsewhere' }); // any later change
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.put).toHaveBeenCalledWith('s', 'a', expect.any(Array));
  });

  it('a failed write does not throw into the caller and is retried on the next change', async () => {
    const t = await hydrated();
    t.put.mockImplementationOnce(() => Promise.reject(new DOMException('full', 'QuotaExceededError')));
    t.setMessages('a', [msg('a1'), msg('a2')]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(console.warn).toHaveBeenCalled();
    expect((await t.backend.loadSurface('s')).a).toHaveLength(1);

    t.useStore.setState({ folder: '/x' });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await t.backend.loadSurface('s')).a).toHaveLength(2);
  });

  it('a deleted conversation is deleted from the backend; undo before that costs nothing', async () => {
    const t = await hydrated();
    const snapshot = t.useStore.getState().messages.a;

    // Delete then undo inside the debounce: the record was never touched.
    t.setMessages('a', undefined);
    t.setMessages('a', snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.remove).not.toHaveBeenCalled();
    expect(t.put).not.toHaveBeenCalled();

    // Delete for real, then undo after it landed: the record comes back.
    t.setMessages('a', undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.remove).toHaveBeenCalledWith('s', 'a');
    expect((await t.backend.loadSurface('s')).a).toBeUndefined();

    t.setMessages('a', snapshot);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await t.backend.loadSurface('s')).a).toEqual(snapshot);
  });

  it('a reload reads back what was written', async () => {
    const t = await hydrated();
    t.setMessages('c', [msg('c1')]);
    await t.storage.flush();

    const again = setup({ backend: t.backend, local: t.local });
    await again.useStore.persist.rehydrate();
    expect(Object.keys(again.useStore.getState().messages).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('clearAllTranscripts', () => {
  it('drops every record and stops pending writes from restoring them', async () => {
    const t = setup();
    await t.backend.put('s', 'a', [msg('a1')]);
    await t.useStore.persist.rehydrate();
    t.setMessages('a', [msg('a1'), msg('a2')]);

    await clearAllTranscripts(async () => t.backend);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(2000);

    expect(await t.backend.loadSurface('s')).toEqual({});
  });
});
