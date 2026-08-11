import { describe, it, expect, afterEach, vi } from 'vitest';
import { webSearchPrompt, hasWebSearchMcp } from './web-search-prompt';
import { getCoworkConfig } from '../cowork-config';
import { getCodeConfig } from '../code-config';

/**
 * The reported bug was "WebFetch may not work; the agent falls back to
 * Bash/curl". WebFetch is reachable on every surface — nothing filters it — so
 * the fault was the prompt, which described a toolset the run did not have.
 *
 * `SEARXNG_INSTANCES` is set nowhere by default (not even in `.env.example`), so
 * the stock configuration hit the branch that told the model its only search
 * tool was one that was never mounted, forbade the two alternatives, and framed
 * WebFetch as a follow-up to search results that could never arrive.
 */

afterEach(() => vi.unstubAllEnvs());

/** The prompt string, whether the config stores it flat or under `append`. */
function promptOf(config: { systemPrompt?: unknown }): string {
  const p = config.systemPrompt;
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object' && 'append' in p) return String((p as { append: unknown }).append);
  return '';
}

describe('hasWebSearchMcp', () => {
  it('tracks SEARXNG_INSTANCES — the same var that decides the mounting', () => {
    vi.stubEnv('SEARXNG_INSTANCES', '');
    expect(hasWebSearchMcp()).toBe(false);
    vi.stubEnv('SEARXNG_INSTANCES', 'https://searx.example');
    expect(hasWebSearchMcp()).toBe(true);
  });
});

describe('webSearchPrompt with no search MCP mounted', () => {
  const prompt = webSearchPrompt('none');

  it('does not claim a web_search tool the run does not have', () => {
    expect(prompt).not.toMatch(/web_search/);
    expect(prompt).not.toMatch(/ONLY search mechanism/);
  });

  it('points at FetchUrl as the way to read a page', () => {
    // NOT WebFetch: it is in the provider's unconditional deny set, so the old
    // wording sent the model at a tool that answers "it has been turned off in
    // settings. Do not try it again" while the working one sat unmentioned.
    expect(prompt).toMatch(/`FetchUrl` is your web tool/);
    expect(prompt).toMatch(/built-in `WebFetch` is turned off/);
    expect(prompt).toMatch(/whenever the user gives you a URL/);
  });

  it('still forbids curl scraping — that part was never the problem', () => {
    expect(prompt).toMatch(/Do NOT use Bash with curl/);
    expect(prompt).toMatch(/Google, DuckDuckGo or Bing/);
  });

  it('gives an honest way out instead of leaving the model to guess', () => {
    expect(prompt).toMatch(/ask the user for a link/);
    expect(prompt).toMatch(/Do not claim to have searched/);
  });

  /**
   * The second bug, and the more expensive one. The branch used to permit a URL
   * the model "can construct and is confident about (… a well-known page)",
   * which for "research the best pizza in Sydney" reads as permission to recall
   * timeout.com and broadsheet.com.au article slugs from training. It did, they
   * 404'd, and it moved on to "let me try a few alternatives" — a guessing loop
   * that renders as ticked-off tool calls and looks like progress.
   */
  describe('does not license recalled URLs', () => {
    it('no longer offers the unfalsifiable "confident about" permission', () => {
      expect(prompt).not.toMatch(/confident about/i);
      expect(prompt).not.toMatch(/well-known page/i);
    });

    it('permits DERIVING a url from a stateable rule', () => {
      expect(prompt).toMatch(/DERIVE a URL/);
      expect(prompt).toMatch(/owner\/repo|documentation root|documented API endpoint/);
    });

    it('forbids RECALLING one, naming the shape that goes wrong', () => {
      expect(prompt).toMatch(/Do NOT RECALL a URL from memory/);
      expect(prompt).toMatch(/article title|listicle|best X in Y/);
    });

    /**
     * The stop rule is the half that would have ended the observed run. Without
     * it the split above just makes the first guess better-argued.
     */
    it('stops after ONE failed derivation rather than trying variations', () => {
      expect(prompt).toMatch(/If a URL you derived fails, stop/);
      expect(prompt).toMatch(/Do not try variations/);
    });

    it('names the case that triggered it as one to hand back to the user', () => {
      expect(prompt).toMatch(/rankings, prices, recent events/);
      expect(prompt).toMatch(/mark it as unverified/);
    });
  });
});

describe('webSearchPrompt with the search MCP mounted', () => {
  const prompt = webSearchPrompt('mcp-searxng');

  it('keeps the original guidance verbatim', () => {
    expect(prompt).toMatch(/tool: `web_search`/);
    expect(prompt).toMatch(/ONLY search mechanism/);
    // The re-fetch restriction only makes sense when search results exist.
    expect(prompt).toMatch(/Do NOT re-fetch URLs already present/);
  });
});

describe('the surfaces that carry the section', () => {
  it.each([
    ['cowork', getCoworkConfig],
    ['code', getCodeConfig],
  ])('%s tells the truth when nothing is mounted', (_name, get) => {
    vi.stubEnv('SEARXNG_INSTANCES', '');
    const prompt = promptOf(get());
    expect(prompt).toMatch(/`FetchUrl` is your web tool/);
    expect(prompt).not.toMatch(/tool: `web_search`/);
  });

  it.each([
    ['cowork', getCoworkConfig],
    ['code', getCodeConfig],
  ])('%s restores the search guidance when it IS mounted', (_name, get) => {
    vi.stubEnv('SEARXNG_INSTANCES', 'https://searx.example');
    const prompt = promptOf(get());
    expect(prompt).toMatch(/tool: `web_search`/);
    expect(prompt).not.toMatch(/`FetchUrl` is your web tool/);
  });

  /*
   * `allowedTools` is an AUTO-APPROVE list, so WebFetch appearing here has
   * never meant it is usable — the provider denies it unconditionally in favour
   * of `mcp__aime__FetchUrl`. Kept as a reminder of that distinction, which is
   * the trap this codebase keeps rediscovering.
   */
  it('leaves WebFetch in allowedTools either way — it was never the blocker', () => {
    vi.stubEnv('SEARXNG_INSTANCES', '');
    expect(getCoworkConfig().allowedTools).toContain('WebFetch');
    expect(getCodeConfig().allowedTools).toContain('WebFetch');
  });
});
