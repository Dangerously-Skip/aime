import { describe, it, expect } from 'vitest';
import { webSearchPrompt, correctWebSearchSection } from './web-search-prompt';
import { getBrowserConfig } from '../browser-config';

/**
 * A RUN WITH A BROWSER IS NEVER TOLD IT CANNOT SEARCH.
 *
 * Reported as "browser agent doesn't seem to understand it's a browser agent".
 * Asked to "search dogs", with Google already open in front of it and
 * `navigate`, `snapshot` and `click` among its sixty-six tools, the agent
 * replied:
 *
 *   "I can't run a general web search here — there's no search engine
 *    available in this environment, so I can't just 'search dogs' and hand you
 *    results. […] give me the link and I'll fetch and read it."
 *
 * …and offered to search the user's iCloud mail instead, because `MailSearch`
 * and `ContactsSearch` were the only tools with "Search" in the name. It called
 * NOTHING.
 *
 * That is a near-verbatim paraphrase of the no-search prompt, which the browser
 * surface was handed unchanged: "There is NO search engine available in this
 * environment", "Do NOT try to scrape Google, DuckDuckGo or Bing by any means",
 * "say so plainly and ask the user for a link". The agent was not confused
 * about its tools. It was obeying its instructions.
 *
 * Worth naming because the first three explanations I checked were wrong — the
 * tools were mounted, the flag was sent, the plumbing was fine. The server log
 * settled it: 66 tools offered including `mcp__aime__navigate`, and zero tool
 * calls. When the wiring is right and the behaviour is wrong, read the prompt.
 */

describe('the web-access prompt with a live browser', () => {
  const withBrowser = (tool: 'none' | 'mcp-searxng') =>
    webSearchPrompt(tool, { browser: true });

  it('never claims there is no search engine — with or without a search API', () => {
    for (const tool of ['none', 'mcp-searxng'] as const) {
      expect(withBrowser(tool), `"${tool}" still denies search`).not.toMatch(
        /NO search engine available|no search engine available/i,
      );
    }
  });

  it('tells the agent to navigate to a search engine', () => {
    expect(withBrowser('none')).toMatch(/navigate/i);
    expect(withBrowser('none')).toMatch(/search engine/i);
  });

  it('does not forbid reaching a search engine "by any means"', () => {
    /*
     * The prohibition that produced the refusal. It is still right about curl —
     * that gets a bot wall and raw markup — and wrong about a real browser,
     * which is a person's browser loading a page with its own session.
     */
    for (const tool of ['none', 'mcp-searxng'] as const) {
      expect(withBrowser(tool)).not.toMatch(/scrape Google.*by any means/i);
      expect(withBrowser(tool)).not.toMatch(/Do NOT try to scrape Google/i);
    }
    // But curl is still out.
    expect(withBrowser('none')).toMatch(/curl/i);
  });

  it('does not tell the agent to ask the user for a link instead', () => {
    expect(withBrowser('none')).not.toMatch(/ask the user for a link/i);
  });

  it('keeps the guard that actually matters: read URLs off the page', () => {
    // The reason the no-search branch existed. A browser removes the need to
    // guess a URL; it does not make guessing safe.
    expect(withBrowser('none')).toMatch(/do not recall a url/i);
  });
});

describe('the no-browser prompt is unchanged', () => {
  it('still refuses search when there is genuinely no way to do it', () => {
    // Chat, Cowork and Code have no webview. The original text is correct
    // there and must not be softened by this fix.
    const plain = webSearchPrompt('none');
    expect(plain).toMatch(/NO search engine available in this environment/);
    expect(plain).toMatch(/Do NOT try to scrape Google/);
  });
});

describe('correcting a prompt built before the webview was known', () => {
  /*
   * The surface config is assembled at import time; whether the run has a live
   * webview is only known per request. So the browser surface BAKES IN the
   * no-browser text and the provider must swap it — this is the seam the bug
   * lived in.
   */
  const baked = getBrowserConfig().systemPrompt as { append: string };

  it('the browser surface really does bake in the no-browser text', () => {
    // If this stops being true the swap below is testing nothing.
    expect(baked.append).toContain(webSearchPrompt('none'));
  });

  it('swaps it for the browser variant when a webview is live', () => {
    const corrected = correctWebSearchSection(baked.append, 'none', { browser: true });
    expect(corrected).not.toMatch(/NO search engine available in this environment/);
    expect(corrected).toContain(webSearchPrompt('none', { browser: true }));
  });

  it('leaves it alone when there is no webview', () => {
    const corrected = correctWebSearchSection(baked.append, 'none', { browser: false });
    expect(corrected).toContain(webSearchPrompt('none'));
  });

  it('corrects search backend and browser-ness together', () => {
    // Both dimensions change per run, and an earlier version of the swap only
    // knew about one of them.
    const corrected = correctWebSearchSection(baked.append, 'mcp-searxng', { browser: true });
    expect(corrected).toContain(webSearchPrompt('mcp-searxng', { browser: true }));
    expect(corrected).not.toMatch(/NO search engine available/);
  });

  it('is a no-op on a prompt it does not recognise', () => {
    const other = 'Some unrelated system prompt.';
    expect(correctWebSearchSection(other, 'none', { browser: true })).toBe(other);
  });
});
