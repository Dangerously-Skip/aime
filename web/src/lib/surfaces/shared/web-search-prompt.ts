/**
 * What to tell the model about searching the web — which depends on whether
 * there is anything to search with.
 *
 * Web search is opt-in: the `web-search` MCP server is only mounted when
 * `SEARXNG_INSTANCES` is set (see claude-provider.ts), and it is set nowhere by
 * default — it is not even in `.env.example`. The built-in `WebSearch` is in
 * `disallowedTools` unconditionally, so it is removed from the model's context.
 *
 * The surface prompts nevertheless said, always:
 *
 *   "You have web search available via the web-search MCP server (tool:
 *    web_search). This is your ONLY search mechanism."
 *   "Do NOT fall back to Bash curl commands to scrape Google..."
 *   "Do NOT use a built-in WebSearch tool — it is not available."
 *   "Do NOT use WebFetch to re-fetch URLs already present in the search results"
 *
 * On a stock install every one of those sentences is about tools that are not
 * there. The model is told its only search tool is one that was never mounted,
 * forbidden from the two alternatives, and told to treat WebFetch as a follow-up
 * to search results that can never arrive. It ends up reaching for `Bash` +
 * `curl` — which is exactly the reported symptom, and looks from the outside
 * like "WebFetch doesn't work". WebFetch is fine; the prompt gave it nothing to
 * do.
 *
 * Read at request time, in the same process that decides the mounting, so the
 * two cannot disagree.
 *
 * ## The second failure, which the first fix caused
 *
 * The no-search branch originally licensed the model to use WebFetch on a URL it
 * "can construct and is confident about (… a well-known page)", while two lines
 * later forbidding it to guess. Asked to research the best pizza in Sydney, the
 * model resolved that contradiction the only way it could: timeout.com and
 * broadsheet.com.au ARE well-known pages, so it recalled three article URLs from
 * training, fetched them, got 404s, and announced "those direct URLs didn't work
 * — let me try a few alternatives".
 *
 * Two things were wrong. "Confident about" is unfalsifiable from the inside —
 * the model has no way to tell a remembered slug from an invented one. And
 * nothing told it to stop, so each retry rendered as a tool call with a tick and
 * a duration, and a failing loop looked like research making progress.
 *
 * So the permission is now split by whether the URL FOLLOWS FROM A RULE
 * (`owner/repo`, a docs root, a documented endpoint — wrong means the rule was
 * wrong) or is RECALLED (an article slug encoding a title or a date — wrong
 * means a fact was invented), and a failed derivation ends the attempt instead
 * of starting a search by other means.
 */
import { hasSearch } from '@/lib/search/resolve';

/**
 * Is a search provider available for this run?
 *
 * Delegates to `resolveSearchRoute` rather than reading env, because this used
 * to be its own reader of `SEARXNG_INSTANCES` and one of three that could
 * disagree. The prompt's whole job is to describe the tools that actually
 * exist, so it must ask the same function the mounting asks.
 *
 * Server-side settings are not reachable from here, so this sees the env path
 * only; the request layer passes an explicit flag when it knows better — which
 * is what the `available` parameter below is for.
 */
export function hasWebSearchMcp(): boolean {
  return hasSearch(null, process.env);
}

/**
 * The "## Web search" section for a surface prompt.
 *
 * @param available override the env check (tests, and any caller that already
 *   knows what it mounted)
 */
/**
 * Which search tool is actually mounted for this run.
 *
 * A boolean was not enough, and the gap was not cosmetic. The "available"
 * branch below names the SearXNG MCP tool (`web_search`) and forbids the
 * built-in — but the MCP is mounted only for searxng. Brave, Tavily and
 * OpenRouter get `mcp__aime__SearchWeb`, and a first-party key gets the SDK's
 * own `WebSearch`. So a Tavily user's prompt told the model to call a tool that
 * answers "No such tool available: mcp__web-search__web_search" and, in the
 * same breath, forbade the only search tool it actually had.
 *
 * Same class of bug as claiming no search while mounting one — which is what
 * sent the model off inventing URLs — just pointed the other way.
 */
export type SearchToolKind =
  /** No search of any kind. */
  | 'none'
  /** The external searxng MCP server. */
  | 'mcp-searxng'
  /** The in-process `SearchWeb` tool (Brave / Tavily / OpenRouter). */
  | 'aime-searchweb'
  /** The SDK's server-side `WebSearch` (first-party Anthropic or Vertex). */
  | 'native';

export const SEARCH_TOOL_KINDS: SearchToolKind[] = [
  'none',
  'mcp-searxng',
  'aime-searchweb',
  'native',
];

/** What to tell the model to call, per mounted tool. */
const TOOL_NAME: Record<Exclude<SearchToolKind, 'none'>, string> = {
  'mcp-searxng': 'web_search',
  'aime-searchweb': 'SearchWeb',
  native: 'WebSearch',
};

export function webSearchPrompt(
  tool: SearchToolKind = hasWebSearchMcp() ? 'mcp-searxng' : 'none',
): string {
  if (tool !== 'none') {
    const name = TOOL_NAME[tool];
    const others = Object.values(TOOL_NAME).filter((n) => n !== name);
    return `## Web search
You have web search available (tool: \`${name}\`). This is your ONLY search mechanism — use it whenever you need to look things up online.
- The results it returns are real, working search results. Trust them and synthesize your answer directly from those results.
- Do NOT fall back to Bash curl commands to scrape Google, DuckDuckGo, Yelp, or any other search engine. This wastes time and produces worse results.
- Do NOT re-fetch URLs already present in the search results unless the user specifically asks for detailed content from a particular page.
- ${others.map((n) => `\`${n}\``).join(' and ')} are NOT mounted in this environment — do not reach for them.
- If the first search doesn't find what you need, refine your query and search again with \`${name}\` — do not switch to curl.`;
  }

  return `## Web access
There is NO search engine available in this environment — no search server is mounted and the built-in WebSearch is disabled. Do not claim to have searched.
- **\`FetchUrl\` is your web tool.** It works, and it is the correct way to read any page. Use it whenever the user gives you a URL. (The built-in \`WebFetch\` is turned off; do not reach for it.)
- You may also DERIVE a URL, but only when the address follows from a name by a rule you can state: a package on a registry, a repository from \`owner/repo\`, an official documentation root, a documented API endpoint. These are stable, and if you are wrong you are wrong about a rule rather than about a fact.
- Do NOT RECALL a URL from memory — anything whose path encodes an article title, a ranking, a date or an edition ("best X in Y", a news story, a blog post, a listicle). You cannot tell a remembered slug from an invented one, and neither can the user reading your answer. A recalled URL that happens to resolve is worse than one that 404s, because nothing marks it as a guess.
- **If a URL you derived fails, stop.** Do not try variations. One failure means the rule did not hold; a second attempt is guessing, and a run of them reads as research when it is not. Say which URL you tried, that it failed, and what you would need.
- Do NOT use Bash with curl or wget to fetch pages. \`FetchUrl\` handles redirects, encoding and content extraction; curl gives you raw markup and search engines block it outright.
- Do NOT try to scrape Google, DuckDuckGo or Bing by any means. It does not work and the results are worthless.
- For anything that needs current information you cannot reach — rankings, prices, recent events, "the best" of anything — say so plainly and ask the user for a link. Answer from what you know, mark it as unverified, and be explicit about what you could not check. That is a complete answer to the question that was asked; a page of dead URLs is not.`;
}

/**
 * Swap the web-access section for the one that matches reality.
 *
 * The surface configs are built before the provider knows what search this run
 * actually has — availability depends on the resolved backend (the SDK's native
 * `WebSearch` needs first-party Anthropic or Vertex) and on the user's search
 * provider, neither of which the config factory can see. So they call
 * `webSearchPrompt()` with an env-only guess and the provider corrects it here.
 *
 * The swap is EXACT, not a heuristic: both strings come from this module, so it
 * either finds the wrong branch verbatim and replaces it, or does nothing. That
 * matters because the failure it prevents is a prompt that contradicts the
 * mounted tools — telling a model it has no search while handing it a search
 * tool is the same class of bug as the reverse, and the reverse is what sent it
 * off inventing URLs.
 */
export function correctWebSearchSection(prompt: string, tool: SearchToolKind): string {
  // Still an EXACT swap, now across every variant this module can emit: find
  // whichever one the config baked in and replace it with the truth. Anything
  // it does not recognise is left alone rather than half-rewritten.
  for (const other of SEARCH_TOOL_KINDS) {
    if (other === tool) continue;
    const wrong = webSearchPrompt(other);
    if (prompt.includes(wrong)) return prompt.replace(wrong, webSearchPrompt(tool));
  }
  return prompt;
}
