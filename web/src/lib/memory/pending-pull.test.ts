// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pullPendingMemories, resetPendingPull } from './pending-pull';
import { useMemoryStore } from '@/stores/memory-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Memory, PendingMemory } from './types';

/*
 * Real stores, so dedup is the store's own behaviour. `fetch` is stubbed: the
 * server half is exercised for real in app/api/memory/pending/route.test.ts,
 * and what is under test here is what the renderer does with the answer.
 */
const gate = vi.hoisted(() => ({ open: true }));
vi.mock('@/lib/gated-storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/gated-storage')>()),
  isStorageGateOpen: () => gate.open,
}));

const item = (id: string, content: string, chatId = 'c1'): PendingMemory => ({
  id,
  chatId,
  createdAt: 1,
  content,
  category: 'fact',
  tags: ['work'],
  confidence: 0.8,
});

/** A server holding `queue`: GET returns it, DELETE removes the named ids (unless told to fail). */
function server(queue: PendingMemory[], opts: { failAck?: boolean; failGet?: boolean } = {}) {
  const calls: { method: string; url: string; ids?: string[] }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      calls.push({ method, url });
      if (opts.failGet) return new Response('nope', { status: 500 });
      return Response.json({ items: queue });
    }
    const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
    calls.push({ method, url, ids });
    if (opts.failAck) return new Response('nope', { status: 500 });
    for (const id of ids) {
      const i = queue.findIndex((q) => q.id === id);
      if (i >= 0) queue.splice(i, 1);
    }
    return Response.json({ removed: ids.length });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const live = (): Memory[] => useMemoryStore.getState().memories.filter((m) => !m.supersededBy);

beforeEach(() => {
  gate.open = true;
  resetPendingPull();
  useMemoryStore.setState({ memories: [] });
  useConversationStore.setState({ conversations: [] } as never);
  useSettingsStore.setState({ autoExtractMemories: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pulling pending memories', () => {
  it('stores each item under its server id, then acknowledges exactly those ids', async () => {
    useConversationStore.setState({
      conversations: [{ id: 'c1', title: 't', surface: 'chat', lastMessage: '', createdAt: 0, updatedAt: 0, projectId: 'p1' }],
    } as never);
    const { calls } = server([item('m1', 'User works on AIME'), item('m2', 'Prefers tabs', 'c2')]);

    expect(await pullPendingMemories()).toBe(2);

    const byId = Object.fromEntries(useMemoryStore.getState().memories.map((m) => [m.id, m]));
    expect(byId.m1).toMatchObject({ content: 'User works on AIME', scope: 'project', projectId: 'p1', source: 'auto' });
    expect(byId.m2).toMatchObject({ content: 'Prefers tabs', scope: 'global', projectId: null });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
    expect(calls[1].ids?.sort()).toEqual(['m1', 'm2']);
  });

  it('asks the server to wait when told to', async () => {
    const { calls } = server([]);
    await pullPendingMemories({ waitMs: 25_000 });
    expect(calls[0].url).toBe('/api/memory/pending?wait=25000');
  });

  it('touches nothing before the persisted stores have loaded', async () => {
    gate.open = false;
    const { fetchMock } = server([item('m1', 'x')]);
    expect(await pullPendingMemories()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not acknowledge when the read failed', async () => {
    const { calls } = server([item('m1', 'x')], { failGet: true });
    expect(await pullPendingMemories()).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('never throws, even with the server gone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(pullPendingMemories()).resolves.toBe(0);
    warn.mockRestore();
  });

  it('drops (and acknowledges) memories when auto-extraction has been switched off', async () => {
    useSettingsStore.setState({ autoExtractMemories: false });
    const { calls } = server([item('m1', 'x')]);
    await pullPendingMemories();
    expect(useMemoryStore.getState().memories).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', ids: ['m1'] });
  });
});

describe('the same item delivered twice is stored once', () => {
  it('content dedup alone would NOT do it: an exact repeat adds a superseding row', () => {
    // Why the id matters — the store's similarity dedup is not idempotent.
    const base = { category: 'fact' as const, scope: 'global' as const, projectId: null, tags: [], confidence: 0.8, accessCount: 0, lastAccessedAt: 0, createdAt: 0, updatedAt: 0, supersededBy: null, source: 'auto' as const };
    useMemoryStore.getState().addMemoryWithDedup({ ...base, id: 'a', content: 'User works on AIME' });
    useMemoryStore.getState().addMemoryWithDedup({ ...base, id: 'b', content: 'User works on AIME' });
    expect(useMemoryStore.getState().memories).toHaveLength(2);
  });

  it('when the ack was lost and the next pull re-delivers', async () => {
    const queue = [item('m1', 'User works on AIME')];
    server(queue, { failAck: true });
    await pullPendingMemories();
    server(queue); // the same item, still queued
    expect(await pullPendingMemories()).toBe(1);

    expect(useMemoryStore.getState().memories).toHaveLength(1);
    expect(queue).toEqual([]);
  });

  it('after a restart, too — the stored id is what catches it', async () => {
    const queue = [item('m1', 'User works on AIME')];
    server(queue, { failAck: true });
    await pullPendingMemories();
    resetPendingPull(); // a new session remembers nothing it handled
    server(queue);
    await pullPendingMemories();
    expect(useMemoryStore.getState().memories).toHaveLength(1);
    expect(queue).toEqual([]);
  });

  it('when two pulls overlap', async () => {
    server([item('m1', 'User works on AIME'), item('m2', 'Prefers tabs')]);
    await Promise.all([pullPendingMemories(), pullPendingMemories()]);
    expect(useMemoryStore.getState().memories.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('for an item merged into an existing memory, which keeps no copy of its id', async () => {
    useMemoryStore.setState({
      memories: [{ id: 'old', content: 'User works on the AIME desktop app', category: 'fact', scope: 'global', projectId: null, tags: ['work'], confidence: 0.6, accessCount: 0, lastAccessedAt: 0, createdAt: 0, updatedAt: 0, supersededBy: null, source: 'auto', updatedCount: 0 }],
    });
    const queue = [item('m1', 'User works on the AIME desktop application')];
    server(queue, { failAck: true });
    await pullPendingMemories();
    // Merged into 'old' rather than stored under its own id.
    expect(live().map((m) => m.id)).toEqual(['old']);
    expect(live()[0].updatedCount).toBe(1);
    const after = live().map((m) => ({ id: m.id, confidence: m.confidence, updatedCount: m.updatedCount }));
    server(queue);
    await pullPendingMemories();
    expect(live().map((m) => ({ id: m.id, confidence: m.confidence, updatedCount: m.updatedCount }))).toEqual(after);
    expect(queue).toEqual([]);
  });
});
