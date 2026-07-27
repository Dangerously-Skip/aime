import type { Memory, MemoryCategory } from './types';

export interface RetrievalContext {
  projectId?: string | null;
  query?: string;
  limit?: number;
  categories?: MemoryCategory[];
}

/**
 * Extract keywords from a string for matching.
 */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

/**
 * Build a document-frequency map across all memories.
 * Returns how many memories contain each term.
 */
function buildDocumentFrequency(memories: Memory[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const m of memories) {
    const words = extractKeywords(m.content);
    m.tags.forEach((t) => extractKeywords(t).forEach((w) => words.add(w)));
    words.forEach((w) => {
      df.set(w, (df.get(w) || 0) + 1);
    });
  }
  return df;
}

/**
 * Compute TF-IDF weighted overlap score between a query and a memory.
 * Terms that appear in fewer memories are weighted more heavily.
 */
function tfidfScore(
  queryKeywords: Set<string>,
  memory: Memory,
  df: Map<string, number>,
  totalDocs: number
): number {
  if (queryKeywords.size === 0) return 0;

  const memoryWords = extractKeywords(memory.content);
  memory.tags.forEach((t) => extractKeywords(t).forEach((w) => memoryWords.add(w)));

  let weightedOverlap = 0;
  let totalWeight = 0;

  queryKeywords.forEach((term) => {
    // IDF: log(N / df), with smoothing to avoid division by zero
    const docFreq = df.get(term) || 0;
    const idf = Math.log((totalDocs + 1) / (docFreq + 1)) + 1;
    totalWeight += idf;
    if (memoryWords.has(term)) {
      weightedOverlap += idf;
    }
  });

  return totalWeight > 0 ? weightedOverlap / totalWeight : 0;
}

/**
 * Compute recency score (0-1) based on lastAccessedAt.
 * More recent = higher score. Decays over 30 days.
 */
function recencyScore(lastAccessedAt: number): number {
  const ageMs = Date.now() - lastAccessedAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - ageDays / 30);
}

export interface RankedMemory {
  memory: Memory;
  /** TF-IDF weighted keyword overlap, 0-1. A query-less retrieval scores 0.5. */
  relevance: number;
  /** relevance 40% + confidence 30% + recency 30%, so 0-1. */
  score: number;
}

export interface RankedMemories {
  /** Up to 3 most recent episodic memories, pinned ahead of the ranking. */
  episodic: Memory[];
  /** Every other candidate, best first. NOT truncated — callers apply the limit. */
  ranked: RankedMemory[];
}

/**
 * Filter and rank, without applying a limit.
 *
 * Exposed so a re-ranker (the graph boost) can add to the REAL score instead of
 * inferring one from list position. Position-derived scores are length-dependent —
 * one rank is worth 1/n — so a fixed additive boost moved a memory ~1.5 ranks in a
 * 12-memory set and ~70 in a 600-memory one. Ranking here is the single source of
 * the keyword score, so there is nothing for a second implementation to drift from.
 *
 * 1. Filter: active (not superseded) + scope match (global + current project)
 * 2. Separate episodic — the 3 most recent are pinned as session context
 * 3. Rank the rest by TF-IDF relevance (40%) + confidence (30%) + recency (30%)
 */
export function rankMemories(
  memories: Memory[],
  ctx: RetrievalContext = {}
): RankedMemories {
  const { projectId = null, query = '', categories } = ctx;

  const filtered = memories.filter((m) => {
    if (m.supersededBy) return false;
    if (m.scope === 'project' && m.projectId !== projectId) return false;
    if (categories?.length && !categories.includes(m.category)) return false;
    return true;
  });

  const episodic = filtered
    .filter((m) => m.category === 'episodic')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);

  const nonEpisodic = filtered.filter((m) => m.category !== 'episodic');

  const queryKeywords = extractKeywords(query);
  const df = buildDocumentFrequency(nonEpisodic);
  const totalDocs = nonEpisodic.length;

  const ranked = nonEpisodic.map((m) => {
    const relevance = queryKeywords.size > 0
      ? tfidfScore(queryKeywords, m, df, totalDocs)
      : 0.5;
    const recency = recencyScore(m.lastAccessedAt);
    return {
      memory: m,
      relevance,
      score: relevance * 0.4 + m.confidence * 0.3 + recency * 0.3,
    };
  });

  // Array#sort is stable, so equal scores keep input order — the same inputs give
  // the same order every time.
  ranked.sort((a, b) => b.score - a.score);

  return { episodic, ranked };
}

/**
 * Retrieve and rank memories for a given context, capped at `limit` (default 20).
 */
export function getMemoriesForContext(
  memories: Memory[],
  ctx: RetrievalContext = {}
): Memory[] {
  const { limit = 20 } = ctx;
  const { episodic, ranked } = rankMemories(memories, ctx);

  // Slice AFTER merging. Slicing only the non-episodic tail by
  // `limit - episodic.length` goes negative once episodic fills the limit, and
  // Array#slice reads a negative end as "all but the last n" — so a limit of 1
  // against 15 memories returned 12 of them.
  return [...episodic, ...ranked.map((r) => r.memory)].slice(0, Math.max(0, limit));
}

/**
 * Simple text search across memory content and tags.
 */
export function searchMemories(memories: Memory[], query: string): Memory[] {
  if (!query.trim()) return memories.filter((m) => !m.supersededBy);
  const lower = query.toLowerCase();
  return memories.filter(
    (m) =>
      !m.supersededBy &&
      (m.content.toLowerCase().includes(lower) ||
        m.tags.some((t) => t.toLowerCase().includes(lower)) ||
        m.category.toLowerCase().includes(lower))
  );
}

/**
 * Compute Jaccard similarity between two tag sets for deduplication.
 */
export function tagSimilarity(tagsA: string[], tagsB: string[]): number {
  const setA = new Set(tagsA.map((t) => t.toLowerCase()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Compute content similarity (Jaccard on keywords) between two texts.
 */
export function contentSimilarity(textA: string, textB: string): number {
  const wordsA = extractKeywords(textA);
  const wordsB = extractKeywords(textB);
  const allWords = new Set([...wordsA, ...wordsB]);
  if (allWords.size === 0) return 0;
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  return intersection.size / allWords.size;
}

/**
 * Find a near-duplicate or duplicate of a new memory.
 * Returns the matching memory and the similarity level:
 * - 'duplicate' (> 0.8): should supersede
 * - 'similar' (> 0.6): should merge
 * - null: no match found
 */
export function findSimilar(
  memories: Memory[],
  newContent: string,
  newTags: string[]
): { memory: Memory; level: 'duplicate' | 'similar' } | null {
  const newWords = extractKeywords(newContent);
  for (const existing of memories) {
    if (existing.supersededBy) continue;
    const existingWords = extractKeywords(existing.content);
    const allWords = new Set([...newWords, ...existingWords]);
    if (allWords.size === 0) continue;
    const intersection = new Set([...newWords].filter((w) => existingWords.has(w)));
    const contentSim = intersection.size / allWords.size;
    const tagSim = tagSimilarity(newTags, existing.tags);
    const combined = contentSim * 0.7 + tagSim * 0.3;
    if (combined > 0.8) return { memory: existing, level: 'duplicate' };
    if (combined > 0.6) return { memory: existing, level: 'similar' };
  }
  return null;
}

/**
 * Legacy findDuplicate for backward compatibility.
 */
export function findDuplicate(
  memories: Memory[],
  newContent: string,
  newTags: string[]
): Memory | null {
  const result = findSimilar(memories, newContent, newTags);
  return result?.level === 'duplicate' ? result.memory : null;
}

/**
 * Format memories for injection into system prompts.
 */
export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => {
    if (m.category === 'episodic') {
      return `- [session] ${m.content}`;
    }
    return `- [${m.category}] ${m.content}`;
  });
  return `<user-memory>\n${lines.join('\n')}\n</user-memory>`;
}
