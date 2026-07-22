import { describe, it, expect } from 'vitest';
import {
  getMemoriesForContext,
  searchMemories,
  tagSimilarity,
  contentSimilarity,
  findSimilar,
  findDuplicate,
  formatMemoriesForPrompt,
} from './retriever';
import type { Memory } from './types';

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
  ...overrides,
});

describe('tagSimilarity', () => {
  it('computes Jaccard similarity case-insensitively', () => {
    expect(tagSimilarity(['react', 'testing'], ['React', 'testing'])).toBe(1);
    expect(tagSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(tagSimilarity(['a'], ['b'])).toBe(0);
  });

  it('treats two empty tag sets as identical', () => {
    expect(tagSimilarity([], [])).toBe(1);
  });
});

describe('contentSimilarity', () => {
  it('is 1 for identical keyword sets and 0 for disjoint ones', () => {
    expect(contentSimilarity('alpha bravo charlie', 'alpha bravo charlie')).toBe(1);
    expect(contentSimilarity('alpha bravo', 'delta echo')).toBe(0);
  });

  it('ignores punctuation and short words', () => {
    expect(contentSimilarity('alpha, bravo! it a is', 'alpha bravo of to')).toBe(1);
  });

  it('returns 0 when neither text has keywords', () => {
    expect(contentSimilarity('a b', 'c d')).toBe(0);
  });
});

describe('findSimilar', () => {
  it('flags near-identical content+tags as duplicate', () => {
    const existing = memory({ content: 'user prefers typescript strict mode', tags: ['prefs'] });
    const result = findSimilar([existing], 'user prefers typescript strict mode', ['prefs']);
    expect(result?.level).toBe('duplicate');
    expect(result?.memory.id).toBe(existing.id);
  });

  it('flags partially-overlapping content as similar', () => {
    // 3-of-5 keyword overlap → contentSim 0.6; identical tags → tagSim 1
    // combined = 0.6*0.7 + 1*0.3 = 0.72 → similar
    const existing = memory({ content: 'alpha bravo charlie delta', tags: ['team'] });
    const result = findSimilar([existing], 'alpha bravo charlie echo', ['team']);
    expect(result?.level).toBe('similar');
  });

  it('returns null for unrelated memories', () => {
    const existing = memory({ content: 'alpha bravo charlie', tags: ['x'] });
    expect(findSimilar([existing], 'delta echo foxtrot', ['y'])).toBeNull();
  });

  it('ignores superseded memories', () => {
    const existing = memory({ content: 'alpha bravo charlie', tags: ['x'], supersededBy: 'newer' });
    expect(findSimilar([existing], 'alpha bravo charlie', ['x'])).toBeNull();
  });
});

describe('findDuplicate', () => {
  it('only returns exact duplicates, not similar matches', () => {
    const dup = memory({ content: 'alpha bravo charlie delta', tags: ['t'] });
    expect(findDuplicate([dup], 'alpha bravo charlie delta', ['t'])?.id).toBe(dup.id);

    const similar = memory({ content: 'alpha bravo charlie delta', tags: ['t'] });
    expect(findDuplicate([similar], 'alpha bravo charlie echo', ['t'])).toBeNull();
  });
});

describe('searchMemories', () => {
  const memories = [
    memory({ content: 'Uses Postgres for storage', tags: ['database'] }),
    memory({ content: 'Prefers dark mode', tags: [], category: 'preference' }),
    memory({ content: 'Old fact', supersededBy: 'x' }),
  ];

  it('matches content, tags and category case-insensitively', () => {
    expect(searchMemories(memories, 'postgres')).toHaveLength(1);
    expect(searchMemories(memories, 'DATABASE')).toHaveLength(1);
    expect(searchMemories(memories, 'preference')).toHaveLength(1);
  });

  it('excludes superseded memories, including for empty queries', () => {
    expect(searchMemories(memories, '')).toHaveLength(2);
    expect(searchMemories(memories, 'Old fact')).toHaveLength(0);
  });
});

describe('getMemoriesForContext', () => {
  it('filters out superseded memories', () => {
    const active = memory({ content: 'active memory' });
    const superseded = memory({ content: 'gone', supersededBy: active.id });
    expect(getMemoriesForContext([active, superseded])).toEqual([active]);
  });

  it('includes global memories plus only the current project scope', () => {
    const globalMem = memory({ content: 'global' });
    const projectA = memory({ content: 'for project a', scope: 'project', projectId: 'a' });
    const projectB = memory({ content: 'for project b', scope: 'project', projectId: 'b' });

    const result = getMemoriesForContext([globalMem, projectA, projectB], { projectId: 'a' });
    expect(result.map((m) => m.content).sort()).toEqual(['for project a', 'global']);
  });

  it('filters by categories when given', () => {
    const pref = memory({ category: 'preference' });
    const fact = memory({ category: 'fact' });
    expect(getMemoriesForContext([pref, fact], { categories: ['preference'] })).toEqual([pref]);
  });

  it('always leads with up to 3 most recent episodic memories', () => {
    const episodic = [1, 2, 3, 4].map((i) =>
      memory({ category: 'episodic', content: `session ${i}`, createdAt: i }),
    );
    const facts = [memory({ content: 'a fact' })];

    const result = getMemoriesForContext([...facts, ...episodic]);
    expect(result.slice(0, 3).map((m) => m.content)).toEqual(['session 4', 'session 3', 'session 2']);
    expect(result.map((m) => m.content)).toContain('a fact');
  });

  it('respects the limit', () => {
    const memories = Array.from({ length: 30 }, (_, i) => memory({ content: `fact ${i}` }));
    expect(getMemoriesForContext(memories, { limit: 5 })).toHaveLength(5);
  });

  it('ranks query-relevant memories above unrelated ones', () => {
    const now = Date.now();
    const relevant = memory({
      content: 'deployment pipeline uses buildkite agents',
      lastAccessedAt: now,
    });
    const unrelated = memory({ content: 'favourite colour is teal', lastAccessedAt: now });

    const result = getMemoriesForContext([unrelated, relevant], {
      query: 'how does the buildkite deployment work',
    });
    expect(result[0].id).toBe(relevant.id);
  });
});

describe('formatMemoriesForPrompt', () => {
  it('returns empty string for no memories', () => {
    expect(formatMemoriesForPrompt([])).toBe('');
  });

  it('wraps memories in a user-memory tag with category labels', () => {
    const out = formatMemoriesForPrompt([
      memory({ category: 'preference', content: 'likes tabs' }),
      memory({ category: 'episodic', content: 'built the parser' }),
    ]);
    expect(out).toContain('<user-memory>');
    expect(out).toContain('- [preference] likes tabs');
    expect(out).toContain('- [session] built the parser');
    expect(out).toContain('</user-memory>');
  });
});
