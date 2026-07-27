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

/**
 * Words that look like names but never are.
 *
 * Deliberately short. A stopword list cannot decide whether a capitalised word is
 * a name — every attempt to make it do so needs six more words the next day. It
 * exists only to keep obvious noise out of the relationship-phrase matches
 * ("works with The team"); query-side candidates are judged by position and by
 * whether the graph actually knows the name (see `extractQueryEntities`).
 */
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

/**
 * Anything that can answer "does this entity id exist?" — `graph.entities` (a Map)
 * and a `Set` of ids both satisfy it, so nothing has to be copied to ask.
 */
export interface KnownEntities {
  has(entityId: string): boolean;
}

/** Checked in this order when a bare capitalised word could be several things. */
const CANDIDATE_TYPES: EntityType[] = ['person', 'topic', 'organisation', 'technology'];

/**
 * Whether the capitalised word at `index` opens a sentence.
 *
 * A capitalised first word is evidence of nothing: every sentence capitalises its
 * first word. Skipping openers is what stops "Can you write a summary" from
 * naming a person called Can.
 */
function opensSentence(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    // Opening punctuation sits between the boundary and the word: 'Write' in
    // `"Write the docs"` is still the first word.
    if (ch === ' ' || ch === '\t' || ch === '"' || ch === "'" || ch === '“' || ch === '‘'
      || ch === '(' || ch === '[' || ch === '{' || ch === '*' || ch === '`') continue;
    if (ch === '\n' || ch === '\r') return true;
    return ch === '.' || ch === '!' || ch === '?' || ch === '…';
  }
  return true;
}

/**
 * Entities named in a free-text query, for graph-boosted retrieval.
 *
 * A query rarely uses the relationship phrasing memory extraction relies on ("who
 * is Sarah?"), so a bare capitalised word is also considered here. Two rules keep
 * that from turning every instruction into a person:
 *
 *  - `known` — when the caller can say which entities exist, that is the only
 *    reliable test of "is this a name", and it costs one Map lookup. Retrieval
 *    passes the graph's entity index.
 *  - position — without a `known` set, a sentence-opening word is skipped.
 *
 * The alternative was a longer stopword list. Before this, `person:can`,
 * `person:please`, `person:what`, `person:write`, `person:fix` and `person:how`
 * were all "people", so capitalisation alone decided whether a query looked
 * entity-free — and the fast path that exists to skip the graph never fired on a
 * sentence-capitalised message.
 */
export function extractQueryEntities(query: string, known?: KnownEntities): Entity[] {
  const text = typeof query === 'string' ? query : '';
  const all = [...extractPeople(text), ...extractTechnologies(text), ...extractOrganisations(text)];

  // Runs of up to two capitalised words, so "Mike Chen" can be recognised as one
  // name before falling back to its parts.
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?\b/g)) {
    const words = [m[1], m[2]].filter((w): w is string => !!w);
    const usable = words.filter(
      (w) => !NAME_STOPWORDS.has(w) && !TECHNOLOGIES.has(w.toLowerCase()),
    );
    if (usable.length === 0) continue;

    if (known) {
      // Prefer the longest run the graph recognises, then each word on its own.
      const candidates = usable.length > 1 ? [usable.join(' '), ...usable] : usable;
      for (const candidate of candidates) {
        const normalised = normaliseEntityName(candidate);
        const type = CANDIDATE_TYPES.find((t) => known.has(`${t}:${normalised}`));
        if (!type) continue;
        all.push(entity(type, candidate));
        // A recognised two-word name is the answer; do not also add its halves.
        if (candidate.includes(' ')) break;
      }
      continue;
    }

    if (opensSentence(text, m.index ?? 0)) continue;
    for (const word of usable) all.push(entity('person', word));
  }

  const byId = new Map<string, Entity>();
  for (const e of all) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}
