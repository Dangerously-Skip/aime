/**
 * The memory graph (P4.3).
 *
 * Graphiti's three useful ideas, on plain data structures rather than its
 * Python + Neo4j stack:
 *
 *  1. ENTITIES — nodes for the people, technologies and organisations memories
 *     talk about (see entities.ts).
 *  2. TEMPORAL EDGES — every edge records when it was asserted, so a stale
 *     connection can be down-weighted rather than treated as equally true. The
 *     existing model already had `supersededBy` for outright replacement; this
 *     adds gradation for everything that merely *ages*.
 *  3. TRAVERSAL — related memories reachable through shared entities, which is
 *     what keyword matching structurally cannot do.
 *
 * On storage: the graph is derived, not persisted. Memories live in the client
 * store, so a SQLite layer would mean migrating persistence — where the risk sits
 * in storage while the value sits in retrieval. Deriving instead buys the
 * retrieval win with none of the migration risk.
 *
 * MEASURED cost of building, rather than assumed: 0.8ms at 100 memories, 3.0ms at
 * 600 (the store's prune trigger), 5.0ms at 1000 and 23ms at 5000 — Node 26 on an
 * M1 Pro; a slower machine measured roughly double. Absolute numbers are
 * machine-dependent, the shape is not: it is milliseconds, per message, growing
 * with memory count. Two earlier versions of this comment were wrong in both
 * directions (one claimed sub-millisecond, one claimed 6.8ms at 1000 where the same
 * machine measured 10ms), which is why the numbers now come with the method.
 *
 * That is too much to pay on every message, so `graphFor()` caches — see the note
 * there for why array identity alone turned out not to be a usable key.
 *
 * If memory volume ever makes even the cached build untenable, the interface here
 * is what an embedded store would implement.
 *
 * Pure: no I/O.
 */
import type { Memory } from '../types';
import { extractEntities, type Entity } from './entities';

export interface GraphEdge {
  /** Entity ids, ordered so a pair has one canonical edge. */
  a: string;
  b: string;
  /** Memory ids asserting this connection. */
  memoryIds: string[];
  /** Highest confidence among the asserting memories. */
  confidence: number;
  /** Most recent assertion — the temporal half of a temporal edge. */
  lastAssertedAt: number;
  /** How many memories assert it; repeated assertion is corroboration. */
  weight: number;
}

export interface MemoryGraph {
  entities: Map<string, Entity>;
  /** entity id → memory ids mentioning it. */
  entityToMemories: Map<string, Set<string>>;
  /** memory id → entity ids it mentions. */
  memoryToEntities: Map<string, Set<string>>;
  /** entity id → neighbouring entity ids. */
  adjacency: Map<string, Set<string>>;
  edges: Map<string, GraphEdge>;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** An empty graph, so callers never deal with undefined. */
export function emptyGraph(): MemoryGraph {
  return {
    entities: new Map(),
    entityToMemories: new Map(),
    memoryToEntities: new Map(),
    adjacency: new Map(),
    edges: new Map(),
  };
}

/**
 * Build the graph from memories.
 *
 * Superseded memories are excluded: they are the model's existing way of saying
 * "this is no longer true", and letting them contribute edges would keep
 * corrected facts influencing retrieval forever.
 */
export function buildMemoryGraph(memories: Memory[]): MemoryGraph {
  const graph = emptyGraph();
  if (!Array.isArray(memories)) return graph;

  for (const memory of memories) {
    if (!memory || typeof memory.id !== 'string' || memory.supersededBy) continue;

    const found = extractEntities(memory);
    if (found.length === 0) continue;

    const ids = new Set<string>();
    for (const e of found) {
      ids.add(e.id);
      if (!graph.entities.has(e.id)) graph.entities.set(e.id, e);
      if (!graph.entityToMemories.has(e.id)) graph.entityToMemories.set(e.id, new Set());
      graph.entityToMemories.get(e.id)!.add(memory.id);
      if (!graph.adjacency.has(e.id)) graph.adjacency.set(e.id, new Set());
    }
    graph.memoryToEntities.set(memory.id, ids);

    // Co-occurrence in one memory is the edge. Not a claim about the nature of
    // the relationship — just that these two things were mentioned together,
    // which is exactly the signal traversal needs.
    const list = [...ids];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        graph.adjacency.get(a)!.add(b);
        graph.adjacency.get(b)!.add(a);

        const key = edgeKey(a, b);
        const existing = graph.edges.get(key);
        const asserted = memory.updatedAt || memory.createdAt || 0;
        if (existing) {
          existing.memoryIds.push(memory.id);
          existing.weight += 1;
          existing.confidence = Math.max(existing.confidence, memory.confidence ?? 0);
          existing.lastAssertedAt = Math.max(existing.lastAssertedAt, asserted);
        } else {
          graph.edges.set(key, {
            a: a < b ? a : b,
            b: a < b ? b : a,
            memoryIds: [memory.id],
            confidence: memory.confidence ?? 0,
            lastAssertedAt: asserted,
            weight: 1,
          });
        }
      }
    }
  }

  return graph;
}

/**
 * Memory ids reachable from a set of entities, with the number of hops taken.
 *
 * Depth is capped deliberately. Beyond two hops almost everything is reachable
 * in a densely connected memory set, at which point a "related" memory means
 * nothing — the boost would become noise applied uniformly.
 */
export function traverse(
  graph: MemoryGraph,
  startEntityIds: string[],
  maxHops = 2,
): Map<string, number> {
  const reached = new Map<string, number>();
  if (maxHops < 0) return reached;

  // maxHops counts EDGES traversed, which is what "two hops" means in ordinary
  // use. Counting rounds of memory collection instead made a genuinely two-edge
  // memory unreachable at maxHops = 2 — found by a test asserting exactly the
  // traversal this exists for.
  const seenEntities = new Set<string>();
  let frontier = startEntityIds.filter((id) => graph.entities.has(id));
  for (const id of frontier) seenEntities.add(id);

  for (let hop = 0; hop <= maxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const entityId of frontier) {
      for (const memoryId of graph.entityToMemories.get(entityId) ?? []) {
        // Keep the SHORTEST path to each memory; a later, longer route must not
        // downgrade a memory already found closer in.
        if (!reached.has(memoryId)) reached.set(memoryId, hop);
      }
      for (const neighbour of graph.adjacency.get(entityId) ?? []) {
        if (seenEntities.has(neighbour)) continue;
        seenEntities.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  return reached;
}

/**
 * Cache keyed on array identity — exact, and a WeakMap so a replaced memories
 * array is collected with its graph rather than leaking one per mutation.
 */
const graphCache = new WeakMap<object, MemoryGraph>();

/**
 * The most recent build, so a NEW array whose graph-relevant content is unchanged
 * reuses it instead of rebuilding. Only one array is pinned at a time.
 */
let lastBuild: { memories: Memory[]; graph: MemoryGraph } | null = null;

function sameTags(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Whether two memories are the same AS FAR AS THE GRAPH IS CONCERNED — every field
 * `buildMemoryGraph` reads, and nothing else. Access bookkeeping (`accessCount`,
 * `lastAccessedAt`) is deliberately absent: it cannot change an entity or an edge.
 */
function sameGraphInput(a: Memory, b: Memory): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.supersededBy === b.supersededBy &&
    a.confidence === b.confidence &&
    (a.updatedAt || a.createdAt || 0) === (b.updatedAt || b.createdAt || 0) &&
    sameTags(a.tags, b.tags)
  );
}

/**
 * The graph for these memories, built once per distinct CONTENT.
 *
 * Array identity alone was not a usable key. It is a sound one — the store updates
 * immutably — but every send handler calls `touchMemory` once per retrieved memory
 * immediately after retrieval, and each touch maps the array: up to 20 fresh array
 * identities per message. Measured hit rate after the first message: zero. The
 * graph was rebuilt on every single message, which is the whole cost the cache
 * exists to avoid.
 *
 * So a new array falls back to comparing against the last build, field by field,
 * over exactly what the graph reads. That is O(n) pointer comparisons plus a few
 * field comparisons for the handful of objects a touch replaced — a rounding error
 * against a rebuild — and unlike a revision counter it cannot be bypassed by a
 * direct `setState`.
 */
export function graphFor(memories: Memory[]): MemoryGraph {
  if (!Array.isArray(memories)) return emptyGraph();

  const cached = graphCache.get(memories);
  if (cached) return cached;

  const prev = lastBuild;
  if (
    prev &&
    prev.memories.length === memories.length &&
    memories.every((m, i) => sameGraphInput(m, prev.memories[i]))
  ) {
    graphCache.set(memories, prev.graph);
    // Compare against the newest array next time, so a long run of touches stays
    // one comparison deep rather than drifting further from the cached build.
    lastBuild = { memories, graph: prev.graph };
    return prev.graph;
  }

  const graph = buildMemoryGraph(memories);
  graphCache.set(memories, graph);
  lastBuild = { memories, graph };
  return graph;
}
