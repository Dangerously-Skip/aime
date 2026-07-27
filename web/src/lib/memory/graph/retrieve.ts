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
 * (hop 0 — she is named in it) and reaches "the design system ships weekly"
 * (one hop onward, through the entity they share) — the second of which has no
 * keyword in common with the question.
 *
 * Pure: no I/O.
 */
import type { Memory } from '../types';
import { rankMemories, type RetrievalContext } from '../retriever';
import { graphFor, traverse } from './graph';
import { extractQueryEntities } from './entities';

/**
 * Boost per hop, on the same scale as the keyword score it is added to.
 *
 * That score is `relevance * 0.4 + confidence * 0.3 + recency * 0.3`, so a perfect
 * keyword match is worth 0.4. Read against that: a direct entity mention (0.35) is
 * worth about as much as a strong keyword match — it IS a match, just not a
 * lexical one — a one-hop neighbour about a third of one (0.12), and two hops an
 * eighth (0.05). A graph connection can therefore lift a memory the keywords
 * missed above unrelated ones, and cannot displace a memory that answers the
 * question outright.
 *
 * These numbers previously sat against a score derived from BASELINE POSITION,
 * where one rank was worth 1/n — so the same 0.12 meant "1.5 ranks" in a
 * 12-memory set and "70 ranks" in a 600-memory one. Whether the graph won depended
 * on how many memories the user happened to have.
 */
const HOP_BOOST = [0.35, 0.12, 0.05];

/** How stale an edge may be before its boost decays. */
const EDGE_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

export interface GraphRetrievalContext extends RetrievalContext {
  /** Set false to fall back to keyword-only behaviour exactly. */
  useGraph?: boolean;
  /** Injected for deterministic tests. */
  now?: number;
}

/**
 * Temporal decay on the boost: a connection asserted long ago is weaker evidence
 * than one asserted last week. This is the "temporal" in temporal edges — the
 * existing model could only mark a memory wholly superseded, with nothing in
 * between.
 *
 * The instant used is the memory's own last assertion (`updatedAt`, falling back
 * to `createdAt`), which is what dates the connection it contributes.
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
 * it is a drop-in replacement at the call site. `result.length <= limit` holds for
 * every input: the merged list is sliced once, at the end. (It used to prepend an
 * unlimited episodic block and clamp only the tail, so four episodic memories made
 * a limit of 1, 2 or 3 all return three — and threw away every non-episodic
 * candidate, including the direct keyword match.)
 */
export function getMemoriesForContextWithGraph(
  memories: Memory[],
  ctx: GraphRetrievalContext = {},
): Memory[] {
  const { query = '', limit = 20, useGraph = true, now = Date.now() } = ctx;

  // The full ranking, with the retriever's real scores — not a truncated window,
  // and not scores re-derived here. `ranked` has already had the scope, category
  // and supersede filters applied, so it is also the allow-list: a memory the
  // graph reaches that is not in it was filtered out for a reason.
  const { episodic, ranked } = rankMemories(memories, ctx);

  // Episodic memories are pinned to the front as recent session context; the boost
  // must not shuffle them out of that role.
  const merge = (rest: Memory[]) => [...episodic, ...rest].slice(0, Math.max(0, limit));
  const keywordOnly = () => merge(ranked.map((r) => r.memory));

  if (!useGraph || !query.trim()) return keywordOnly();

  // Cached per distinct memory content, so this is a comparison rather than a
  // build on all but the first message.
  const graph = graphFor(memories);

  // The graph's entity index is what decides whether a capitalised word in the
  // query is a name. Cheaper and far more accurate than any stopword list, and it
  // means an entity-free query costs one cached graph lookup.
  const queryEntities = extractQueryEntities(query, graph.entities);
  if (queryEntities.length === 0) return keywordOnly();

  const reached = traverse(graph, queryEntities.map((e) => e.id), HOP_BOOST.length - 1);
  if (reached.size === 0) return keywordOnly();

  const boosted = ranked.map(({ memory, score }, index) => {
    const hops = reached.get(memory.id);
    let boost = 0;
    if (hops !== undefined && hops < HOP_BOOST.length) {
      const asserted = memory.updatedAt || memory.createdAt || 0;
      boost = HOP_BOOST[hops] * temporalFactor(asserted, now) * (memory.confidence ?? 1);
    }
    return { memory, index, score: score + boost };
  });

  // Ties break on the keyword ranking's own order, so with no boosts in play the
  // result is exactly the keyword retriever's — the graph can only add.
  boosted.sort((x, y) => y.score - x.score || x.index - y.index);

  return merge(boosted.map((b) => b.memory));
}
