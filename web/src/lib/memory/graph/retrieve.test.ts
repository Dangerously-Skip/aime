import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildMemoryGraph, traverse, neighbourhood, entitiesOf, emptyGraph } from './graph';
import { getMemoriesForContextWithGraph, explainRetrieval } from './retrieve';
import { getMemoriesForContext } from '../retriever';
import type { Memory } from '../types';

const NOW = 1_750_000_000_000;
const day = 24 * 60 * 60 * 1000;

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

  it('exposes a memory\'s entities and an entity\'s neighbourhood', () => {
    const graph = buildMemoryGraph([mem('Works with Sarah on Figma', { id: 'x' })]);
    expect(entitiesOf(graph, 'x').map((e) => e.id).sort()).toEqual([
      'person:sarah',
      'technology:figma',
    ]);
    const hood = neighbourhood(graph, 'person:sarah');
    expect(hood.memoryIds).toEqual(['x']);
    expect(hood.related.map((r) => r.entity.id)).toEqual(['technology:figma']);
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
    const fresh = getMemoriesForContextWithGraph(memories, { query: 'Sarah', limit: 5, now: NOW });
    const stale = getMemoriesForContextWithGraph(
      memories.map((m) => (m.id === 'ds' ? { ...m, updatedAt: NOW - 800 * day } : m)),
      { query: 'Sarah', limit: 5, now: NOW },
    );
    const boostOf = (list: ReturnType<typeof explainRetrieval>) =>
      list.find((s) => s.memory.id === 'ds')?.boost ?? 0;

    expect(boostOf(explainRetrieval(memories, { query: 'Sarah', limit: 5, now: NOW })))
      .toBeGreaterThan(
        boostOf(
          explainRetrieval(
            memories.map((m) => (m.id === 'ds' ? { ...m, updatedAt: NOW - 800 * day } : m)),
            { query: 'Sarah', limit: 5, now: NOW },
          ),
        ),
      );
    expect(fresh.length).toBe(stale.length);
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

  it('explainRetrieval reports hops and boost for what it returned', () => {
    const explained = explainRetrieval(memories, { query: 'Sarah', limit: 3, now: NOW });
    const direct = explained.find((s) => s.memory.id === 'sarah');
    expect(direct?.hops).toBe(0);
    expect(direct?.boost).toBeGreaterThan(0);
    expect(explained.length).toBeLessThanOrEqual(3);
  });
});

describe('properties', () => {
  const memArb = fc.array(
    fc.record({
      id: fc.uuid(),
      content: fc.string(),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { maxLength: 25 },
  );

  it('never throws, and never exceeds the limit, for any memories and query', () => {
    fc.assert(
      fc.property(memArb, fc.string(), fc.integer({ min: 1, max: 10 }), (raw, query, limit) => {
        const memories = raw.map((r) => mem(r.content, { id: r.id, confidence: r.confidence }));
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
        const memories = raw.map((r) => mem(r.content, { id: r.id, confidence: r.confidence }));
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
        const memories = raw.map((r) => mem(r.content, { id: r.id, confidence: r.confidence }));
        const a = getMemoriesForContextWithGraph(memories, { query, limit: 6, now: NOW });
        const b = getMemoriesForContextWithGraph(memories, { query, limit: 6, now: NOW });
        expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
      }),
      { numRuns: 200 },
    );
  });
});
