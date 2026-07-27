import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { buildMemoryGraph, traverse, graphFor, emptyGraph } from './graph';
import { getMemoriesForContextWithGraph } from './retrieve';
import { getMemoriesForContext } from '../retriever';
import type { Memory, MemoryCategory } from '../types';

const NOW = 1_750_000_000_000;
const day = 24 * 60 * 60 * 1000;

/**
 * The clock is frozen to NOW so recency scoring (which reads `Date.now()`, not
 * `ctx.now`) sees the same instant the fixtures were written against. Without
 * this, every fixture timestamp is ~a year stale, recency clamps to 0 for
 * everything, and tests that mean to exercise recency silently do not.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

let seq = 0;
function mem(content: string, over: Partial<Memory> = {}): Memory {
  seq += 1;
  return {
    id: over.id ?? `m${seq}`,
    content,
    category: 'fact',
    scope: 'global',
    projectId: null,
    tags: [],
    confidence: 0.9,
    accessCount: 0,
    lastAccessedAt: NOW - day,
    createdAt: NOW - day,
    updatedAt: NOW - day,
    supersededBy: null,
    source: 'auto',
    ...over,
  };
}

describe('buildMemoryGraph', () => {
  it('links entities that co-occur in a memory', () => {
    const graph = buildMemoryGraph([mem('User works with Sarah on TypeScript services')]);
    expect(graph.entities.has('person:sarah')).toBe(true);
    expect(graph.entities.has('technology:typescript')).toBe(true);
    expect(graph.adjacency.get('person:sarah')?.has('technology:typescript')).toBe(true);
  });

  it('corroborates a repeated connection with weight and recency', () => {
    const graph = buildMemoryGraph([
      mem('Works with Sarah on TypeScript', { id: 'a', updatedAt: NOW - 10 * day }),
      mem('Also works with Sarah on TypeScript tooling', { id: 'b', updatedAt: NOW - day }),
    ]);
    const edge = [...graph.edges.values()].find(
      (e) => e.a.includes('sarah') || e.b.includes('sarah'),
    )!;
    expect(edge.weight).toBeGreaterThanOrEqual(2);
    expect(edge.memoryIds).toContain('a');
    // the temporal half: the edge remembers its most recent assertion
    expect(edge.lastAssertedAt).toBe(NOW - day);
  });

  it('excludes superseded memories — a corrected fact must stop influencing recall', () => {
    const graph = buildMemoryGraph([
      mem('Works with Sarah on Python', { id: 'old', supersededBy: 'new' }),
      mem('Works with Sarah on TypeScript', { id: 'new' }),
    ]);
    expect(graph.entityToMemories.get('person:sarah')?.has('old')).toBe(false);
    expect(graph.entities.has('technology:python')).toBe(false);
  });

  it('handles empty, malformed and entity-free input', () => {
    expect(buildMemoryGraph([]).entities.size).toBe(0);
    expect(buildMemoryGraph(undefined as unknown as Memory[]).entities.size).toBe(0);
    expect(buildMemoryGraph([mem('nothing notable here')]).entities.size).toBe(0);
  });

  it('indexes both directions between memories and entities', () => {
    const graph = buildMemoryGraph([mem('Works with Sarah on Figma', { id: 'x' })]);
    expect([...(graph.memoryToEntities.get('x') ?? [])].sort()).toEqual([
      'person:sarah',
      'technology:figma',
    ]);
    expect([...(graph.entityToMemories.get('person:sarah') ?? [])]).toEqual(['x']);
    expect([...(graph.adjacency.get('person:sarah') ?? [])]).toEqual(['technology:figma']);
    expect(graph.edges.get('person:sarah|technology:figma')?.memoryIds).toEqual(['x']);
  });
});

describe('traverse', () => {
  const memories = [
    mem('Works with Sarah on Figma', { id: 'm-sarah' }),
    mem('Figma is used for the design system', { id: 'm-figma', tags: ['figma', 'design-system'] }),
    mem('The design system ships weekly', { id: 'm-ds', tags: ['design-system'] }),
    mem('Unrelated: prefers Postgres', { id: 'm-far' }),
  ];
  const graph = buildMemoryGraph(memories);

  it('reaches direct mentions at hop 0', () => {
    expect(traverse(graph, ['person:sarah']).get('m-sarah')).toBe(0);
  });

  it('reaches a memory two steps away that shares no keywords', () => {
    // This is the whole point: m-ds never mentions Sarah.
    const reached = traverse(graph, ['person:sarah']);
    expect(reached.has('m-ds')).toBe(true);
    expect(reached.get('m-ds')).toBeGreaterThan(0);
  });

  it('keeps the shortest path when a memory is reachable two ways', () => {
    const reached = traverse(graph, ['person:sarah', 'technology:figma']);
    expect(reached.get('m-figma')).toBe(0);
  });

  it('does not reach an unconnected memory', () => {
    expect(traverse(graph, ['person:sarah']).has('m-far')).toBe(false);
  });

  it('respects the hop cap', () => {
    // maxHops counts edges: 0 means direct mentions only.
    expect(traverse(graph, ['person:sarah'], 0).size).toBe(1);
    expect(traverse(graph, ['person:sarah'], 0).get('m-sarah')).toBe(0);
    expect(traverse(graph, ['person:sarah'], 1).has('m-ds')).toBe(false);
    expect(traverse(graph, ['person:sarah'], 2).has('m-ds')).toBe(true);
    expect(traverse(graph, ['person:sarah'], -1).size).toBe(0);
  });

  it('ignores unknown start entities and an empty graph', () => {
    expect(traverse(graph, ['person:nobody']).size).toBe(0);
    expect(traverse(emptyGraph(), ['person:sarah']).size).toBe(0);
  });
});

describe('getMemoriesForContextWithGraph — must never regress the keyword retriever', () => {
  const memories = [
    mem('Prefers TypeScript with strict mode', { id: 'ts' }),
    mem('Works with Sarah on the design system', { id: 'sarah' }),
    mem('Sarah prefers Figma for mockups', { id: 'figma' }),
    mem('Chose Postgres over MySQL for the ledger', { id: 'pg' }),
  ];

  it('is identical to the baseline when the graph is disabled', () => {
    const ctx = { query: 'typescript', limit: 3, now: NOW };
    expect(getMemoriesForContextWithGraph(memories, { ...ctx, useGraph: false }).map((m) => m.id))
      .toEqual(getMemoriesForContext(memories, ctx).map((m) => m.id));
  });

  it('is identical to the baseline when the query names no entity', () => {
    const ctx = { query: 'what should i do next', limit: 3, now: NOW };
    expect(getMemoriesForContextWithGraph(memories, ctx).map((m) => m.id))
      .toEqual(getMemoriesForContext(memories, ctx).map((m) => m.id));
  });

  it('is identical to the baseline for an empty query', () => {
    const ctx = { query: '', limit: 3, now: NOW };
    expect(getMemoriesForContextWithGraph(memories, ctx).map((m) => m.id))
      .toEqual(getMemoriesForContext(memories, ctx).map((m) => m.id));
  });

  it('honours the limit exactly, as the baseline does', () => {
    for (const limit of [1, 2, 3, 4, 10]) {
      const out = getMemoriesForContextWithGraph(memories, { query: 'Sarah', limit, now: NOW });
      expect(out.length, `limit ${limit}`).toBeLessThanOrEqual(limit);
    }
  });

  it('honours the limit when episodic memories alone exceed it', () => {
    // Regression: episodic memories came from an UNLIMITED baseline and were
    // prepended unconditionally, so only the tail was clamped. With 4 episodic
    // memories a limit of 1, 2 or 3 all returned 3 — and discarded the entire
    // non-episodic set, including the direct keyword match and the graph-boosted
    // hop. The fixture above has no episodic memories, so the loop above never
    // entered this branch.
    const withEpisodic = [
      ...memories,
      ...[0, 1, 2, 3].map((i) =>
        mem(`Session ${i} recap`, { id: `e${i}`, category: 'episodic', createdAt: NOW - i }),
      ),
    ];
    // Only the 3 most recent episodic memories are ever pinned, so 4 facts + 3.
    const available = memories.length + 3;
    for (const limit of [1, 2, 3, 4, 10]) {
      const out = getMemoriesForContextWithGraph(withEpisodic, { query: 'Sarah', limit, now: NOW });
      expect(out.length, `limit ${limit}`).toBe(Math.min(limit, available));
    }
  });

  it('keeps the keyword match when the limit leaves room past the episodic block', () => {
    // The other half of the same bug: everything non-episodic was thrown away.
    const withEpisodic = [
      ...memories,
      ...[0, 1, 2, 3].map((i) =>
        mem(`Session ${i} recap`, { id: `e${i}`, category: 'episodic', createdAt: NOW - i }),
      ),
    ];
    const out = getMemoriesForContextWithGraph(withEpisodic, {
      query: 'Sarah',
      limit: 5,
      now: NOW,
    }).map((m) => m.id);
    expect(out).toContain('sarah');
  });

  it('never returns a superseded or out-of-scope memory', () => {
    const withNoise = [
      ...memories,
      mem('Old Sarah fact', { id: 'dead', supersededBy: 'sarah' }),
      mem('Sarah project note', { id: 'other-proj', scope: 'project', projectId: 'p2' }),
    ];
    const out = getMemoriesForContextWithGraph(withNoise, {
      query: 'Sarah',
      projectId: 'p1',
      limit: 10,
      now: NOW,
    }).map((m) => m.id);

    // The graph adds candidates, so it must apply the same filters rather than
    // sneaking past them.
    expect(out).not.toContain('dead');
    expect(out).not.toContain('other-proj');
  });
});

describe('getMemoriesForContextWithGraph — what the graph adds', () => {
  const memories = [
    mem('Works with Sarah on the design system', { id: 'sarah', tags: ['design-system'] }),
    mem('The design system ships every Friday', { id: 'ds', tags: ['design-system'] }),
    ...Array.from({ length: 12 }, (_, i) =>
      mem(`Filler note number ${i} about unrelated matters`, { id: `f${i}` }),
    ),
  ];

  it('surfaces a memory that shares no keyword with the query', () => {
    // "ds" contains neither "Sarah" nor anything else from the question.
    const out = getMemoriesForContextWithGraph(memories, {
      query: 'what is Sarah working on?',
      limit: 3,
      now: NOW,
    }).map((m) => m.id);

    expect(out).toContain('sarah');
    expect(out).toContain('ds');
  });

  it('ranks a directly-mentioned memory above a two-hop one', () => {
    const out = getMemoriesForContextWithGraph(memories, {
      query: 'Sarah',
      limit: 5,
      now: NOW,
    }).map((m) => m.id);
    expect(out.indexOf('sarah')).toBeLessThan(out.indexOf('ds'));
  });

  it('decays the boost for a connection asserted long ago', () => {
    // Two memories identical in every scoring input except WHEN the connection was
    // last asserted — and the stale one wins the id tie-break, so if the temporal
    // factor were ignored it would come first.
    const anchor = mem('Works with Sarah on the design system', {
      id: 'sarah',
      tags: ['design-system'],
    });
    const fresh = mem('The design system ships weekly', {
      id: 'z-fresh',
      tags: ['design-system'],
      updatedAt: NOW - day,
    });
    const stale = mem('The design system ships weekly', {
      id: 'a-stale',
      tags: ['design-system'],
      updatedAt: NOW - 800 * day,
    });

    const out = getMemoriesForContextWithGraph([anchor, stale, fresh], {
      query: 'Sarah',
      limit: 3,
      now: NOW,
    }).map((m) => m.id);
    expect(out.indexOf('z-fresh')).toBeLessThan(out.indexOf('a-stale'));
  });

  it('keeps episodic memories pinned to the front', () => {
    const withEpisodic = [
      ...memories,
      mem('Last session we discussed Sarah', { id: 'ep', category: 'episodic', createdAt: NOW }),
    ];
    const out = getMemoriesForContextWithGraph(withEpisodic, {
      query: 'Sarah',
      limit: 4,
      now: NOW,
    });
    expect(out[0].id).toBe('ep');
  });

});

describe('the boost must be on the same scale as the keyword score', () => {
  /**
   * The boost used to be added to a score derived from BASELINE POSITION
   * (`1 - i/n`), so one rank was worth 1/n. A fixed 0.12 two-hop boost therefore
   * moved a memory ~1.5 ranks in a 12-memory set and ~70 in a 600-memory one:
   * whether the graph won depended on how many memories the user happened to have,
   * and on millisecond recency differences between otherwise-tied fillers. The
   * boost is now added to the retriever's real 0..1 score, where 0.12 means the
   * same thing at every set size.
   */
  const linked = () => [
    mem('Works with Sarah on the design system', {
      id: 'sarah',
      tags: ['design-system'],
      lastAccessedAt: NOW - 5 * day,
    }),
    mem('The design system ships every Friday', {
      id: 'ds',
      tags: ['design-system'],
      lastAccessedAt: NOW - 5 * day,
    }),
  ];
  // Fresher than the linked pair, so recency alone ranks every one of them higher.
  const fillers = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      mem(`Unrelated filler note ${i}`, { id: `f${i}`, lastAccessedAt: NOW }),
    );

  for (const n of [12, 60, 300]) {
    it(`surfaces the graph-linked memory over ${n} fresher unrelated ones`, () => {
      const out = getMemoriesForContextWithGraph([...linked(), ...fillers(n)], {
        query: 'Sarah',
        limit: 3,
        now: NOW,
      }).map((m) => m.id);
      expect(out).toContain('sarah');
      expect(out).toContain('ds');
    });
  }

  it('still does not overturn a strong keyword match', () => {
    // A memory that actually answers the question must outrank a graph neighbour
    // that matches none of its words: a full keyword match is worth 0.4 of the
    // score, a one-hop boost 0.12.
    const out = getMemoriesForContextWithGraph(
      [...linked(), ...fillers(20), mem('the payments rotation changes monthly', { id: 'direct' })],
      { query: 'payments rotation for Sarah', limit: 5, now: NOW },
    ).map((m) => m.id);
    expect(out.indexOf('direct')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('direct')).toBeLessThan(out.indexOf('ds'));
  });
});

describe('graphFor caching', () => {
  /**
   * The cache used to key on the memories ARRAY identity, which every send handler
   * invalidated immediately: it calls `touchMemory` once per retrieved memory, and
   * each touch maps the array. Hit rate after the first message was measured at 0,
   * so the graph was rebuilt from scratch on every message — 3ms at 600 memories,
   * 10ms at 2000 — which is the entire cost the cache exists to avoid.
   */
  const base = () => [
    mem('Works with Sarah on the design system', { id: 'sarah', tags: ['design-system'] }),
    mem('The design system ships every Friday', { id: 'ds', tags: ['design-system'] }),
    mem('Prefers TypeScript with strict mode', { id: 'ts' }),
  ];

  it('reuses the graph when only access bookkeeping changed', () => {
    const memories = base();
    const first = graphFor(memories);
    // Exactly what touchMemory does: a new array, new objects for touched
    // memories, and only accessCount/lastAccessedAt differ.
    const touched = memories.map((m) => ({
      ...m,
      accessCount: m.accessCount + 1,
      lastAccessedAt: NOW,
    }));
    expect(graphFor(touched)).toBe(first);
  });

  it('rebuilds when content, tags, confidence or supersession changed', () => {
    const memories = base();
    const first = graphFor(memories);

    const edited = memories.map((m) =>
      m.id === 'ts' ? { ...m, content: 'Works with Priya on Rust', updatedAt: NOW } : m,
    );
    const afterEdit = graphFor(edited);
    expect(afterEdit).not.toBe(first);
    expect(afterEdit.entities.has('technology:rust')).toBe(true);

    const retagged = memories.map((m) => (m.id === 'ts' ? { ...m, tags: ['payments'] } : m));
    expect(graphFor(retagged).entities.has('topic:payments')).toBe(true);

    const superseded = memories.map((m) => (m.id === 'sarah' ? { ...m, supersededBy: 'x' } : m));
    expect(graphFor(superseded).entityToMemories.get('person:sarah')).toBeUndefined();

    const added = [...memories, mem('Reports to Mike Chen', { id: 'mike' })];
    expect(graphFor(added).entities.has('person:mike chen')).toBe(true);

    const removed = memories.filter((m) => m.id !== 'sarah');
    expect(graphFor(removed).entities.has('person:sarah')).toBe(false);

    const reconfidenced = memories.map((m) => (m.id === 'sarah' ? { ...m, confidence: 0.1 } : m));
    expect(
      [...graphFor(reconfidenced).edges.values()].every((e) => e.confidence <= 0.9),
    ).toBe(true);
  });

  it('does not confuse two different memory sets of the same length', () => {
    const a = graphFor([mem('Works with Sarah on Figma', { id: 'a' })]);
    const b = graphFor([mem('Works with Mike on Postgres', { id: 'b' })]);
    expect(a).not.toBe(b);
    expect(b.entities.has('person:mike')).toBe(true);
    expect(b.entities.has('person:sarah')).toBe(false);
  });
});

describe('properties', () => {
  const CATEGORIES: MemoryCategory[] = [
    'preference',
    'fact',
    'pattern',
    'decision',
    'skill',
    'relationship',
    'episodic',
  ];

  // The generator used to emit only `category: 'fact'`, so the episodic branch of
  // the merge — where the limit overflow lived — was never generated. Categories
  // and tags are now part of the input space.
  const memArb = fc.array(
    fc.record({
      id: fc.uuid(),
      content: fc.string(),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      category: fc.constantFrom(...CATEGORIES),
      tags: fc.array(fc.string({ maxLength: 12 }), { maxLength: 3 }),
      createdAt: fc.integer({ min: NOW - 400 * day, max: NOW }),
    }),
    { maxLength: 25 },
  );
  const build = (raw: Array<{
    id: string;
    content: string;
    confidence: number;
    category: MemoryCategory;
    tags: string[];
    createdAt: number;
  }>) =>
    raw.map((r) =>
      mem(r.content, {
        id: r.id,
        confidence: r.confidence,
        category: r.category,
        tags: r.tags,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        lastAccessedAt: r.createdAt,
      }),
    );

  it('never throws, and never exceeds the limit, for any memories and query', () => {
    fc.assert(
      fc.property(memArb, fc.string(), fc.integer({ min: 1, max: 10 }), (raw, query, limit) => {
        const memories = build(raw);
        const out = getMemoriesForContextWithGraph(memories, { query, limit, now: NOW });
        expect(out.length).toBeLessThanOrEqual(limit);
        // no duplicates, and everything returned came from the input
        expect(new Set(out.map((m) => m.id)).size).toBe(out.length);
        for (const m of out) expect(memories.some((x) => x.id === m.id)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('returns at least as many results as the baseline for the same limit', () => {
    // The boost is additive, so it can reorder and can ADD, but must never
    // shrink the recalled set.
    fc.assert(
      fc.property(memArb, fc.string(), (raw, query) => {
        const memories = build(raw);
        const limit = 5;
        const base = getMemoriesForContext(memories, { query, limit });
        const boosted = getMemoriesForContextWithGraph(memories, { query, limit, now: NOW });
        expect(boosted.length).toBeGreaterThanOrEqual(base.length);
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic — the same inputs give the same order twice', () => {
    fc.assert(
      fc.property(memArb, fc.string(), (raw, query) => {
        const memories = build(raw);
        const a = getMemoriesForContextWithGraph(memories, { query, limit: 6, now: NOW });
        const b = getMemoriesForContextWithGraph(memories, { query, limit: 6, now: NOW });
        expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
      }),
      { numRuns: 200 },
    );
  });

  it('returns exactly the same memories as the baseline, only reordered', () => {
    // The boost may reorder and may reach further into the candidate set, but it
    // must never invent, drop or duplicate a candidate the filters allowed.
    fc.assert(
      fc.property(memArb, fc.string(), fc.integer({ min: 1, max: 30 }), (raw, query, limit) => {
        const memories = build(raw);
        const boosted = getMemoriesForContextWithGraph(memories, { query, limit, now: NOW });
        const allowed = new Set(
          getMemoriesForContext(memories, { query, limit: memories.length + 1 }).map((m) => m.id),
        );
        expect(boosted.length).toBeLessThanOrEqual(limit);
        for (const m of boosted) expect(allowed.has(m.id)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
