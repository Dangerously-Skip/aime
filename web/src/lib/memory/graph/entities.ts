/**
 * Entity extraction from memory text (P4.3).
 *
 * Today's retriever matches on keyword overlap, so asking "who is on the payments
 * team?" only surfaces memories containing the word "payments". A memory saying
 * "Sarah is the designer on payments" and another saying "Sarah prefers Figma"
 * are unrelated as far as retrieval is concerned, even though a person plainly
 * connects them.
 *
 * This is the first of Graphiti's three useful ideas — entities, temporal edges,
 * traversal — implemented WITHOUT its Python and Neo4j stack, which is far too
 * heavy for a local-first Electron app.
 *
 * Heuristic and deterministic, not model-driven. Retrieval runs on every message,
 * so it must be fast, offline and give the same answer twice; an LLM call here
 * would make context assembly non-deterministic and slow. The cost is that
 * extraction is imperfect, which is why edges carry weights rather than being
 * treated as facts.
 *
 * Pure: no I/O.
 */
import type { Memory } from '../types';

export type EntityType = 'person' | 'technology' | 'organisation' | 'topic';

export interface Entity {
  /** Stable, comparable id: `type:normalised-name`. */
  id: string;
  type: EntityType;
  /** As first seen, for display. */
  name: string;
}

/**
 * Technologies worth recognising by name. A closed list beats a pattern here:
 * "Go" and "Rust" are ordinary words, and guessing from capitalisation alone
 * produced far more noise than signal.
 */
const TECHNOLOGIES = new Set([
  'typescript', 'javascript', 'python', 'rust', 'go', 'golang', 'java', 'kotlin', 'swift',
  'ruby', 'php', 'c#', 'c++', 'sql', 'html', 'css', 'bash', 'zsh',
  'react', 'vue', 'svelte', 'angular', 'next.js', 'nextjs', 'nuxt', 'remix', 'astro',
  'node', 'node.js', 'deno', 'bun', 'express', 'fastify', 'django', 'flask', 'rails',
  'postgres', 'postgresql', 'mysql', 'sqlite', 'redis', 'mongodb', 'dynamodb', 'neo4j',
  'docker', 'kubernetes', 'terraform', 'ansible', 'aws', 'gcp', 'azure', 'vercel',
  'cloudflare', 'netlify', 'github', 'gitlab', 'jira', 'confluence', 'slack', 'figma',
  'linear', 'notion', 'miro', 'stripe', 'tailwind', 'zustand', 'redux', 'graphql',
  'rest', 'grpc', 'kafka', 'rabbitmq', 'electron', 'playwright', 'vitest', 'jest',
  'cypress', 'webpack', 'vite', 'esbuild', 'rollup', 'eslint', 'prettier',
]);

/** Words that look like names but never are. */
const NAME_STOPWORDS = new Set([
  'I', 'The', 'This', 'That', 'These', 'Those', 'A', 'An', 'And', 'But', 'Or', 'If',
  'When', 'While', 'User', 'They', 'He', 'She', 'It', 'We', 'You', 'His', 'Her',
  'Their', 'Our', 'My', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

/** Role words that reliably introduce or follow a person. */
const ROLE_WORDS = /\b(designer|developer|engineer|manager|pm|lead|director|analyst|architect|founder|cto|ceo|colleague|teammate)\b/i;

export function normaliseEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The leading run of Capitalised words, up to two. Returns null when the first
 * word is not capitalised, so a lowercase match contributes nothing.
 */
function leadingProperNoun(candidate: string): string | null {
  const words = candidate.trim().split(/\s+/).slice(0, 2);
  const kept: string[] = [];
  for (const w of words) {
    if (!/^[A-Z][a-z]+$/.test(w)) break;
    kept.push(w);
  }
  return kept.length > 0 ? kept.join(' ') : null;
}

function entity(type: EntityType, name: string): Entity {
  return { id: `${type}:${normaliseEntityName(name)}`, type, name: name.trim() };
}

/**
 * People. Anchored on explicit relationship phrasing rather than bare
 * capitalisation, because "Chose Next.js" would otherwise yield a person called
 * "Chose". Precision matters more than recall: a wrong edge actively misleads
 * retrieval, whereas a missing one merely leaves it no worse than today.
 */
function extractPeople(text: string): Entity[] {
  const found = new Map<string, Entity>();
  const add = (raw: string) => {
    const name = raw.trim();
    if (!name || NAME_STOPWORDS.has(name)) return;
    if (TECHNOLOGIES.has(name.toLowerCase())) return;
    const e = entity('person', name);
    if (!found.has(e.id)) found.set(e.id, e);
  };

  // "works with Sarah", "Reports to Mike Chen", "pairs with Ana Lopez".
  //
  // The PHRASE is matched case-insensitively so a sentence-initial "Reports to"
  // is found. That flag also loosens the name pattern, which briefly turned
  // "works with Sarah on the payments team" into a person called "Sarah on" — so
  // the candidate is captured loosely and trimmed to its leading run of properly
  // capitalised words in code, where case can be judged exactly.
  for (const m of text.matchAll(
    /\b(?:works with|working with|reports to|pairs with|paired with|manages|managed by|met with|spoke to|asked)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/gi,
  )) {
    const name = leadingProperNoun(m[1]);
    if (name) add(name);
  }

  // "Sarah (designer)", "Mike (PM)"
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*\(\s*[^)]*\)/g)) {
    if (ROLE_WORDS.test(m[0])) add(m[1]);
  }

  // "Sarah is the designer", "Mike is a PM", "Priya is the engineering manager".
  // The role phrase is captured whole — testing only the first word missed
  // anything qualified, which is most real job titles.
  for (const m of text.matchAll(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is\s+(?:the|a|an|our|my)\s+([a-z][a-z ]*)/g,
  )) {
    if (ROLE_WORDS.test(m[2])) add(m[1]);
  }

  return [...found.values()];
}

function extractTechnologies(text: string): Entity[] {
  const found = new Map<string, Entity>();
  // Tokenise keeping dots and pluses, so "next.js" and "c++" survive.
  for (const token of text.match(/[A-Za-z][A-Za-z0-9.+#-]*/g) ?? []) {
    const key = token.toLowerCase().replace(/[.,;:]+$/, '');
    if (!TECHNOLOGIES.has(key)) continue;
    const e = entity('technology', key);
    if (!found.has(e.id)) found.set(e.id, e);
  }
  return [...found.values()];
}

/** "at Acme Corp", "for Globex Ltd". */
function extractOrganisations(text: string): Entity[] {
  const found = new Map<string, Entity>();
  for (const m of text.matchAll(
    /\b(?:at|for|joined|left)\s+([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*)?)\s*(?:\b(?:Corp|Inc|Ltd|LLC|GmbH|Plc)\b)?/g,
  )) {
    // Drop a corporate suffix so "Acme" and "Acme Corp" are the same entity —
    // otherwise a query naming one would not match a memory naming the other.
    const name = m[1].trim().replace(/\s+(?:Corp|Corporation|Inc|Ltd|Limited|LLC|GmbH|Plc|Co)\.?$/i, '');
    if (!name || NAME_STOPWORDS.has(name) || TECHNOLOGIES.has(name.toLowerCase())) continue;
    const e = entity('organisation', name);
    if (!found.has(e.id)) found.set(e.id, e);
  }
  return [...found.values()];
}

/**
 * Tags are curated by the user or the extractor, so they are the highest-quality
 * signal available and are promoted to entities directly.
 */
function extractFromTags(tags: string[]): Entity[] {
  return tags
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .map((t) => (TECHNOLOGIES.has(t.toLowerCase()) ? entity('technology', t) : entity('topic', t)));
}

/** Every entity a single memory mentions, deduplicated. */
export function extractEntities(memory: Pick<Memory, 'content' | 'tags'>): Entity[] {
  const text = typeof memory.content === 'string' ? memory.content : '';
  const tags = Array.isArray(memory.tags) ? memory.tags : [];

  const all = [
    ...extractPeople(text),
    ...extractTechnologies(text),
    ...extractOrganisations(text),
    ...extractFromTags(tags),
  ];

  const byId = new Map<string, Entity>();
  for (const e of all) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

/** Entities named in a free-text query, for graph-boosted retrieval. */
export function extractQueryEntities(query: string): Entity[] {
  const text = typeof query === 'string' ? query : '';
  const all = [...extractPeople(text), ...extractTechnologies(text), ...extractOrganisations(text)];

  // A query rarely uses relationship phrasing ("who is Sarah?"), so also accept a
  // bare capitalised name here — looser than for memories, because a wrong query
  // entity only widens the candidate set rather than polluting stored knowledge.
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    const name = m[1];
    if (NAME_STOPWORDS.has(name) || TECHNOLOGIES.has(name.toLowerCase())) continue;
    all.push(entity('person', name));
  }

  const byId = new Map<string, Entity>();
  for (const e of all) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}
