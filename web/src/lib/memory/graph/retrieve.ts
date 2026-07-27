/**
 * Graph-boosted retrieval (P4.3).
 *
 * Wraps the existing TF-IDF retriever rather than replacing it. The boost is
 * ADDITIVE and bounded: a memory reachable through the graph gains score, and
 * nothing ever loses it. That is a deliberate constraint — the keyword retriever
 * has tests and known behaviour, so the graph has to earn its place by improving
 * results, not by being trusted enough to take over.
 *
 * What it buys: a query naming an entity now reaches memories that never contain
 * the query's words. "What do I know about Sarah?" finds "Sarah prefers Figma"
 * (one hop, she is named) and can reach "the design system is owned by payments"
 * (two hops, via a shared entity) — neither of which shares a keyword with the
 * question.
 *
 * Pure: no I/O.
 */
import type { Memory } from '../types';
import { getMemoriesForContext, type RetrievalContext } from '../retriever';
import { graphFor, traverse, type MemoryGraph } from './graph';
import { extractQueryEntities } from './entities';

/**
 * Boost per hop. A direct mention is worth much more than a shared neighbour,
 * and the values are small relative to the base score's 0..1 range so the graph
 * reorders near-ties rather than overturning a strong keyword match.
 */
const HOP_BOOST = [0.35, 0.12, 0.05];

/** How stale an edge may be before its boost decays. */
const EDGE_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

export interface GraphRetrievalContext extends RetrievalContext {
  /** Prebuilt graph, to avoid rebuilding per request. */
  graph?: MemoryGraph;
  /** Set false to fall back to keyword-only behaviour exactly. */
  useGraph?: boolean;
  /** Injected for deterministic tests. */
  now?: number;
}

export interface ScoredMemory {
  memory: Memory;
  /** Hops from a query entity, or null when only keywords matched. */
  hops: number | null;
  boost: number;
}

/**
 * Temporal decay on the boost: a connection asserted long ago is weaker evidence
 * than one asserted last week. This is the "temporal" in temporal edges — the
 * existing model could only mark a memory wholly superseded, with nothing in
 * between.
 */
function temporalFactor(lastAssertedAt: number, now: number): number {
  if (!lastAssertedAt) return 0.5;
  const age = Math.max(0, now - lastAssertedAt);
  return 0.5 + 0.5 * Math.pow(0.5, age / EDGE_HALF_LIFE_MS);
}

/**
 * Retrieve with the graph boost applied.
 *
 * Returns the same shape and honours the same limit as the keyword retriever, so
 * it is a drop-in replacement at the call site.
 */
export function getMemoriesForContextWithGraph(
  memories: Memory[],
  ctx: GraphRetrievalContext = {},
): Memory[] {
  const { query = '', limit = 20, useGraph = true, now = Date.now() } = ctx;

  // Rank EVERYTHING the base retriever would consider, not a truncated window.
  //
  // With a window, a memory the graph reached but keywords missed scored 0 for
  // relevance, so a 0.12 two-hop boost could not beat a mid-ranked keyword result
  // — and whether it won depended on millisecond-level recency differences. That
  // made the headline behaviour ("surfaces a memory sharing no keyword")
  // intermittent, which a flaky test of mine exposed.
  //
  // Ranking the full set gives every candidate a meaningful base score, so the
  // boost adds signal instead of fighting an artefact of where the window fell.
  const baseline = getMemoriesForContext(memories, { ...ctx, limit: memories.length });

  if (!useGraph || !query.trim()) return baseline.slice(0, limit);

  const queryEntities = extractQueryEntities(query);
  if (queryEntities.length === 0) return baseline.slice(0, limit);

  const graph = ctx.graph ?? graphFor(memories);
  const reached = traverse(graph, queryEntities.map((e) => e.id), HOP_BOOST.length - 1);
  if (reached.size === 0) return baseline.slice(0, limit);

  // The baseline now spans everything the scope and supersede filters permit, so
  // it doubles as the allow-list: a graph-reached memory that is not in it was
  // filtered out for a reason and must stay out.
  const candidates = new Map<string, Memory>();
  baseline.forEach((m) => candidates.set(m.id, m));

  // Baseline position stands in for the keyword score: the retriever returns a
  // ranked list, and re-deriving its internal score here would duplicate — and
  // then drift from — its weighting.
  const basePosition = new Map(baseline.map((m, i) => [m.id, i]));
  const scored: ScoredMemory[] = [...candidates.values()].map((memory) => {
    const position = basePosition.get(memory.id);
    const baseScore = position === undefined ? 0 : 1 - position / Math.max(baseline.length, 1);

    const hops = reached.get(memory.id) ?? null;
    let boost = 0;
    if (hops !== null && hops < HOP_BOOST.length) {
      const asserted = memory.updatedAt || memory.createdAt || 0;
      boost = HOP_BOOST[hops] * temporalFactor(asserted, now) * (memory.confidence ?? 1);
    }
    return { memory, hops, boost, score: baseScore + boost } as ScoredMemory & { score: number };
  }) as Array<ScoredMemory & { score: number }>;

  // Episodic memories are pinned to the front by the base retriever as recent
  // session context; the boost must not shuffle them out of that role.
  const episodic = baseline.filter((m) => m.category === 'episodic');
  const episodicIds = new Set(episodic.map((m) => m.id));

  const rest = (scored as Array<ScoredMemory & { score: number }>)
    .filter((s) => !episodicIds.has(s.memory.id))
    .sort((x, y) => y.score - x.score || (x.memory.id < y.memory.id ? -1 : 1))
    .slice(0, Math.max(0, limit - episodic.length))
    .map((s) => s.memory);

  return [...episodic, ...rest];
}

/**
 * Retrieval with the reasoning attached, for the memory UI and for explaining why
 * something was recalled. Same ranking as above.
 */
export function explainRetrieval(
  memories: Memory[],
  ctx: GraphRetrievalContext = {},
): ScoredMemory[] {
  const { query = '', now = Date.now() } = ctx;
  const selected = getMemoriesForContextWithGraph(memories, ctx);
  const graph = ctx.graph ?? graphFor(memories);
  const reached = traverse(
    graph,
    extractQueryEntities(query).map((e) => e.id),
    HOP_BOOST.length - 1,
  );

  return selected.map((memory) => {
    const hops = reached.get(memory.id) ?? null;
    const asserted = memory.updatedAt || memory.createdAt || 0;
    return {
      memory,
      hops,
      boost:
        hops !== null && hops < HOP_BOOST.length
          ? HOP_BOOST[hops] * temporalFactor(asserted, now) * (memory.confidence ?? 1)
          : 0,
    };
  });
}
