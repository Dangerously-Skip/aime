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
 */

/** Is the searxng-backed `web-search` MCP server mounted for this run? */
export function hasWebSearchMcp(): boolean {
  return !!process.env.SEARXNG_INSTANCES;
}

/**
 * The "## Web search" section for a surface prompt.
 *
 * @param available override the env check (tests, and any caller that already
 *   knows what it mounted)
 */
export function webSearchPrompt(available: boolean = hasWebSearchMcp()): string {
  if (available) {
    return `## Web search
You have web search available via the web-search MCP server (tool: web_search). This is your ONLY search mechanism — use it whenever you need to look things up online.
- The results it returns are real, working search results. Trust them and synthesize your answer directly from those results.
- Do NOT fall back to Bash curl commands to scrape Google, DuckDuckGo, Yelp, or any other search engine. This wastes time and produces worse results.
- Do NOT use WebFetch to re-fetch URLs already present in the search results unless the user specifically asks for detailed content from a particular page.
- Do NOT use a built-in WebSearch tool — it is not available in this environment.
- If the first search doesn't find what you need, refine your query and search again with the MCP tool — do not switch to curl.`;
  }

  return `## Web access
There is NO search engine available in this environment — no search server is mounted and the built-in WebSearch is disabled. Do not claim to have searched.
- **WebFetch is your web tool.** It works, and it is the correct way to read any page. Use it whenever you have a URL, or can construct one you are confident about (a documentation site, a repository, an API endpoint, a well-known page).
- Do NOT use Bash with curl or wget to fetch pages. WebFetch handles redirects, encoding and content extraction; curl gives you raw markup and search engines block it outright.
- Do NOT try to scrape Google, DuckDuckGo or Bing by any means. It does not work and the results are worthless.
- If you genuinely need a search and have no usable URL, say so plainly and ask the user for a link, rather than guessing or scraping. Answer from what you know and be explicit about what you could not check.`;
}
