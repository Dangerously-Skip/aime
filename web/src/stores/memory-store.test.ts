import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMemoryStore } from './memory-store';
import { graphFor } from '@/lib/memory/graph/graph';
import type { Memory } from '@/lib/memory/types';

/**
 * FIXED clock, never `Date.now()` per memory.
 *
 * This fixture used to call `Date.now()` three times per memory, so a single
 * millisecond tick partway through building a fixture changed the retrieval
 * ranking: identical timestamps produced [sarah, ds, f0] and 1ms apart produced
 * [sarah, f9, f8]. That made a graph-retrieval test intermittent — it failed once
 * on a clean tree and then passed 18 runs. Freezing the clock makes the fixture
 * and the recency scoring inside the retriever agree on one instant.
 */
const NOW = 1_750_000_000_000;
const day = 24 * 60 * 60 * 1000;

let seq = 0;
const memory = (overrides: Partial<Memory> = {}): Memory => ({
  id: `m${++seq}`,
  content: 'some fact',
  category: 'fact',
  scope: 'global',
  projectId: null,
  tags: [],
  confidence: 0.8,
  accessCount: 0,
  lastAccessedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  supersededBy: null,
  source: 'auto',
  updatedCount: 0,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useMemoryStore.setState({ memories: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

const store = () => useMemoryStore.getState();

describe('addMemoryWithDedup', () => {
  it('adds unrelated memories as new entries', () => {
    store().addMemoryWithDedup(memory({ content: 'alpha bravo charlie' }));
    store().addMemoryWithDedup(memory({ content: 'delta echo foxtrot' }));
    expect(store().memories).toHaveLength(2);
  });

  it('supersedes an existing memory on duplicate content', () => {
    const original = memory({ content: 'user prefers strict typescript', tags: ['prefs'] });
    store().addMemoryWithDedup(original);

    const replacement = memory({ content: 'user prefers strict typescript', tags: ['prefs'] });
    store().addMemoryWithDedup(replacement);

    const memories = store().memories;
    expect(memories).toHaveLength(2);
    expect(memories.find((m) => m.id === original.id)?.supersededBy).toBe(replacement.id);
    expect(memories.find((m) => m.id === replacement.id)?.supersededBy).toBeNull();
  });

  it('merges similar memories instead of adding a new one', () => {
    // contentSim 3/4 = 0.75, tagSim 1/2 = 0.5 → combined 0.675 → 'similar'
    const existing = memory({
      content: 'alpha bravo charlie delta',
      tags: ['team'],
      confidence: 0.7,
      updatedCount: 0,
    });
    store().addMemoryWithDedup(existing);
    store().addMemoryWithDedup(memory({ content: 'alpha bravo charlie', tags: ['extra', 'team'] }));

    const memories = store().memories;
    expect(memories).toHaveLength(1);
    const merged = memories[0];
    expect(merged.id).toBe(existing.id);
    expect(merged.confidence).toBeCloseTo(0.75); // bumped by 0.05
    expect(merged.updatedCount).toBe(1);
    expect(merged.tags.sort()).toEqual(['extra', 'team']);
    expect(merged.content).toBe('alpha bravo charlie delta'); // longer content wins
  });

  it('keeps the longer content when merging', () => {
    // 3-of-5 keyword overlap keeps this in the 'similar' band
    const existing = memory({ content: 'alpha bravo charlie delta', tags: ['t'] });
    store().addMemoryWithDedup(existing);
    store().addMemoryWithDedup(memory({ content: 'alpha bravo charlie deltoid', tags: ['t'] }));

    expect(store().memories).toHaveLength(1);
    expect(store().memories[0].content).toBe('alpha bravo charlie deltoid');
  });

  it('caps merged confidence at 1', () => {
    const existing = memory({ content: 'alpha bravo charlie delta', tags: ['t'], confidence: 0.98 });
    store().addMemoryWithDedup(existing);
    store().addMemoryWithDedup(memory({ content: 'alpha bravo charlie echo', tags: ['t'] }));
    expect(store().memories[0].confidence).toBeLessThanOrEqual(1);
  });
});

describe('supersedeMemory', () => {
  it('links the old memory to its replacement', () => {
    const old = memory({ content: 'old version' });
    store().addMemory(old);
    const next = memory({ content: 'new version' });
    store().supersedeMemory(old.id, next);

    const memories = store().memories;
    expect(memories[0].id).toBe(next.id);
    expect(memories.find((m) => m.id === old.id)?.supersededBy).toBe(next.id);
  });
});

describe('touchMemory', () => {
  it('increments access count', () => {
    const m = memory();
    store().addMemory(m);
    store().touchMemory(m.id);
    store().touchMemory(m.id);
    expect(store().memories[0].accessCount).toBe(2);
  });
});

describe('cleanupMemories', () => {
  it('hard-deletes superseded memories older than 30 days', () => {
    const staleMs = NOW - 31 * day;
    store().addMemory(memory({ supersededBy: 'x', updatedAt: staleMs }));
    store().addMemory(memory({ supersededBy: 'x', updatedAt: NOW }));
    store().addMemory(memory());

    const removed = store().cleanupMemories();
    expect(removed).toBe(1);
    expect(store().memories).toHaveLength(2);
  });

  it('prunes to the retention target when over the trigger threshold', () => {
    const memories = Array.from({ length: 601 }, (_, i) =>
      memory({ content: `unique fact number ${i}` }),
    );
    useMemoryStore.setState({ memories });

    store().cleanupMemories();
    expect(store().memories).toHaveLength(500);
  });

  it('keeps higher-retention memories when pruning', () => {
    const keeper = memory({
      id: 'keeper',
      category: 'preference',
      confidence: 1,
      accessCount: 50,
      lastAccessedAt: NOW,
    });
    const filler = Array.from({ length: 600 }, () =>
      memory({
        category: 'decision',
        confidence: 0.1,
        accessCount: 0,
        lastAccessedAt: NOW - 90 * day,
      }),
    );
    useMemoryStore.setState({ memories: [...filler, keeper] });

    store().cleanupMemories();
    expect(store().memories.some((m) => m.id === 'keeper')).toBe(true);
  });
});

describe('getMemoriesForContext — graph boost wired at the choke point (P4.3)', () => {
  /**
   * Wired in the store rather than at each surface: chat, code and cowork all
   * call through this one method. The P3.5 lesson was that per-call-site wiring
   * is where one site silently gets forgotten.
   */
  const linkedSet = () => [
    memory({
      id: 'sarah',
      content: 'Works with Sarah on the design system',
      tags: ['design-system'],
      lastAccessedAt: NOW - 5 * day,
    }),
    memory({
      id: 'ds',
      content: 'The design system ships every Friday',
      tags: ['design-system'],
      lastAccessedAt: NOW - 5 * day,
    }),
    // Fresher than the linked pair: recency alone ranks all of them higher, so the
    // graph boost has to actually win rather than ride on fixture ordering.
    ...Array.from({ length: 10 }, (_, i) =>
      memory({ id: `f${i}`, content: `Unrelated filler note ${i}`, lastAccessedAt: NOW }),
    ),
  ];

  it('surfaces a memory connected only through a shared entity', () => {
    useMemoryStore.setState({ memories: linkedSet() });

    const out = store().getMemoriesForContext({ query: 'what is Sarah working on?', limit: 3 });
    const ids = out.map((m) => m.id);

    // "ds" shares no keyword with the question — only an entity.
    expect(ids).toContain('sarah');
    expect(ids).toContain('ds');
  });

  it('keeps the graph cached across consecutive messages', () => {
    // Every send handler calls touchMemory once per retrieved memory, so the old
    // array-identity cache key was invalidated up to 20 times per message and the
    // hit rate after the first message was measured at 0 — rebuilding the graph on
    // every single message.
    useMemoryStore.setState({
      memories: Array.from({ length: 120 }, (_, i) =>
        memory({
          id: `s${i}`,
          content: `Works with Sarah on topic ${i % 20} using TypeScript`,
          tags: [`topic-${i % 20}`],
        }),
      ),
    });

    const seen: ReturnType<typeof graphFor>[] = [];
    for (let message = 0; message < 5; message++) {
      const out = store().getMemoriesForContext({ query: 'what is Sarah working on?' });
      seen.push(graphFor(useMemoryStore.getState().memories));
      // Exactly what the surfaces do after retrieval.
      out.forEach((m) => store().touchMemory(m.id));
    }

    const hits = seen.filter((g, i) => i > 0 && g === seen[i - 1]).length;
    expect(hits).toBe(4);
    expect(useMemoryStore.getState().memories.some((m) => m.accessCount > 0)).toBe(true);
  });

  it('rebuilds the graph when a memory is actually added', () => {
    useMemoryStore.setState({ memories: linkedSet() });
    const before = graphFor(useMemoryStore.getState().memories);
    store().addMemory(memory({ id: 'new', content: 'Reports to Mike Chen' }));
    const after = graphFor(useMemoryStore.getState().memories);
    expect(after).not.toBe(before);
    expect(after.entities.has('person:mike chen')).toBe(true);
  });

  it('is stable — the same store state gives the same answer every time', () => {
    useMemoryStore.setState({ memories: linkedSet() });
    const first = store()
      .getMemoriesForContext({ query: 'what is Sarah working on?', limit: 3 })
      .map((m) => m.id);
    for (let i = 0; i < 25; i++) {
      expect(
        store()
          .getMemoriesForContext({ query: 'what is Sarah working on?', limit: 3 })
          .map((m) => m.id),
      ).toEqual(first);
    }
  });

  it('still honours the limit and excludes superseded memories', () => {
    useMemoryStore.setState({
      memories: [
        memory({ id: 'live', content: 'Works with Sarah on payments' }),
        memory({ id: 'dead', content: 'Works with Sarah on the old ledger', supersededBy: 'live' }),
      ],
    });

    const out = store().getMemoriesForContext({ query: 'Sarah', limit: 1 });
    expect(out).toHaveLength(1);
    expect(out.map((m) => m.id)).not.toContain('dead');
  });

  it('is unchanged for a query naming no entity', () => {
    useMemoryStore.setState({
      memories: [
        memory({ id: 'a', content: 'Prefers tabs over spaces' }),
        memory({ id: 'b', content: 'Likes concise commit messages' }),
      ],
    });
    const out = store().getMemoriesForContext({ query: 'anything at all', limit: 5 });
    expect(out.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });
});
