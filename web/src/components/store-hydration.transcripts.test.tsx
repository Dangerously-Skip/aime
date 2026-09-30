// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { createMemoryTranscriptBackend } from '@/lib/transcripts/backend';

/**
 * "Rehydrated" has to keep meaning "the transcripts are here".
 *
 * Transcripts moved out of localStorage into a database that answers
 * asynchronously. If the rehydrate resolved on the localStorage half alone,
 * every returning user would see their conversation list with nothing in it
 * for however long the database took — and anything gated on
 * `useRehydrated` would act on that emptiness. So the read is held here and
 * the flag must wait for it.
 */

let releaseLoad: () => void = () => {};
const backend = createMemoryTranscriptBackend();
const realLoad = backend.loadSurface.bind(backend);
backend.loadSurface = async (surface) => {
  await new Promise<void>((resolve) => {
    const prev = releaseLoad;
    releaseLoad = () => {
      prev();
      resolve();
    };
  });
  return realLoad(surface);
};
vi.mock('@/lib/transcripts/idb-backend', () => ({
  getTranscriptBackend: () => Promise.resolve(backend),
}));

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } satisfies Storage);
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StoreHydration with transcripts in the database', () => {
  it('reports rehydrated only once the transcripts have loaded', async () => {
    await backend.put('chat', 'c1', [{ id: 'm1', role: 'user', content: 'still here', timestamp: 1 }]);
    const { StoreHydration, useRehydrated } = await import('./store-hydration');
    const { useChatStore } = await import('@/stores/chat-store');

    function Probe() {
      const ready = useRehydrated();
      const count = useChatStore((s) => s.messages.c1?.length ?? 0);
      return <span data-testid="p">{`${ready}:${count}`}</span>;
    }
    render(<StoreHydration><Probe /></StoreHydration>);

    // Everything else has had ample time; the transcript read is still held.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId('p').textContent).toBe('false:0');

    await act(async () => {
      releaseLoad();
      await new Promise((r) => setTimeout(r, 20));
    });
    // Never "rehydrated" with an empty conversation.
    expect(screen.getByTestId('p').textContent).toBe('true:1');
  });
});
