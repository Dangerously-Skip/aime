import type { Memory, MemoryCategory } from './types';

interface RetrievalContext {
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
 * Compute keyword overlap score between a query and a memory.
 */
function keywordOverlap(queryKeywords: Set<string>, memory: Memory): number {
  if (queryKeywords.size === 0) return 0;
  const memoryWords = extractKeywords(memory.content);
  memory.tags.forEach((t) => extractKeywords(t).forEach((w) => memoryWords.add(w)));
  let overlap = 0;
  queryKeywords.forEach((kw) => {
    if (memoryWords.has(kw)) overlap++;
  });
  return overlap / queryKeywords.size;
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

/**
 * Retrieve and rank memories for a given context.
 *
 * 1. Filter: active (not superseded) + scope match (global + current project)
 * 2. Rank by: confidence (40%) + recency (30%) + keyword overlap (30%)
 * 3. Limit to top N (default 20)
 */
export function getMemoriesForContext(
  memories: Memory[],
  ctx: RetrievalContext = {}
): Memory[] {
  const { projectId = null, query = '', limit = 20, categories } = ctx;

  // 1. Filter
  let filtered = memories.filter((m) => {
    // Must be active (not superseded)
    if (m.supersededBy) return false;
    // Scope match: global always included, project only if matching
    if (m.scope === 'project' && m.projectId !== projectId) return false;
    // Category filter
    if (categories?.length && !categories.includes(m.category)) return false;
    return true;
  });

  // 2. Rank
  const queryKeywords = extractKeywords(query);
  const scored = filtered.map((m) => {
    const confidenceScore = m.confidence;
    const recency = recencyScore(m.lastAccessedAt);
    const overlap = queryKeywords.size > 0 ? keywordOverlap(queryKeywords, m) : 0.5;
    const score = confidenceScore * 0.4 + recency * 0.3 + overlap * 0.3;
    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // 3. Limit
  return scored.slice(0, limit).map((s) => s.memory);
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
 * Check if a new memory is a duplicate of an existing one.
 * Uses content overlap (lowercase Jaccard on words) + tag similarity.
 */
export function findDuplicate(
  memories: Memory[],
  newContent: string,
  newTags: string[]
): Memory | null {
  const newWords = extractKeywords(newContent);
  for (const existing of memories) {
    if (existing.supersededBy) continue;
    const existingWords = extractKeywords(existing.content);
    // Content similarity
    const allWords = new Set([...newWords, ...existingWords]);
    if (allWords.size === 0) continue;
    const intersection = new Set([...newWords].filter((w) => existingWords.has(w)));
    const contentSim = intersection.size / allWords.size;
    // Tag similarity
    const tagSim = tagSimilarity(newTags, existing.tags);
    // Combined score (content weighted more)
    const combined = contentSim * 0.7 + tagSim * 0.3;
    if (combined > 0.8) return existing;
  }
  return null;
}

/**
 * Format memories for injection into system prompts.
 */
export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `- [${m.category}] ${m.content}`);
  return `<user-memory>\n${lines.join('\n')}\n</user-memory>`;
}
