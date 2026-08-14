/**
 * Read the search results out of what `SearchWeb` actually returned.
 *
 * WHY THIS EXISTS. The Cowork sidebar used to populate its search card by
 * re-running the query against `/api/search-proxy`. That was harmless while the
 * only backend was a self-hosted SearXNG — a free duplicate — and became a real
 * cost the moment the gate was widened to `SearchWeb`, which is the
 * Brave/Tavily/OpenRouter path: a research turn with twelve agent searches
 * issued twenty-four billable queries, twelve of them discarded except for a UI
 * card.
 *
 * It was also capable of showing the user a DIFFERENT result set than the model
 * reasoned over, since nothing tied the two queries together.
 *
 * Both go away by reading the tool's own output, which reaches the client now
 * that tool results are emitted from the `user` message the SDK actually sends.
 * The format is the one `SearchWeb` writes:
 *
 *     1. Title
 *        https://example.com/a
 *        A snippet.
 *
 *     2. …
 */

export interface ParsedSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** The sentinel `SearchWeb` returns for a genuinely empty result set. */
const EMPTY = /^No results for /;

export function parseSearchWebResults(text: unknown): ParsedSearchResult[] {
  if (typeof text !== 'string' || !text.trim() || EMPTY.test(text.trim())) return [];

  const out: ParsedSearchResult[] = [];
  // Entries are separated by a blank line and start with `N. `.
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const title = /^\d+\.\s+(.*)$/.exec(lines[0])?.[1]?.trim();
    if (!title) continue;

    const url = lines.find((l) => /^https?:\/\//i.test(l));
    if (!url) continue;

    // Everything after the URL line is the snippet; it can wrap.
    const snippet = lines.slice(lines.indexOf(url) + 1).join(' ').trim();
    out.push({ title, url, snippet });
  }
  return out;
}

/**
 * Is this the in-process search tool, whose output `parseSearchWebResults`
 * understands?
 *
 * Deliberately NOT the external searxng MCP: that returns its own shape, and it
 * is free to re-query, so the sidebar keeps its proxy call for that one.
 */
export function isParsableSearchTool(name: unknown): boolean {
  return typeof name === 'string' && (name.endsWith('SearchWeb') || name === 'WebSearch');
}
