import { describe, it, expect, beforeEach } from 'vitest';
import { useMemoryStore } from './memory-store';
import type { Memory } from '@/lib/memory/types';

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
  lastAccessedAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  supersededBy: null,
  source: 'auto',
  updatedCount: 0,
  ...overrides,
});

beforeEach(() => {
  useMemoryStore.setState({ memories: [] });
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
    const staleMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    store().addMemory(memory({ supersededBy: 'x', updatedAt: staleMs }));
    store().addMemory(memory({ supersededBy: 'x', updatedAt: Date.now() }));
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
    const now = Date.now();
    const keeper = memory({
      id: 'keeper',
      category: 'preference',
      confidence: 1,
      accessCount: 50,
      lastAccessedAt: now,
    });
    const filler = Array.from({ length: 600 }, () =>
      memory({
        category: 'decision',
        confidence: 0.1,
        accessCount: 0,
        lastAccessedAt: now - 90 * 24 * 60 * 60 * 1000,
      }),
    );
    useMemoryStore.setState({ memories: [...filler, keeper] });

    store().cleanupMemories();
    expect(store().memories.some((m) => m.id === 'keeper')).toBe(true);
  });
});
