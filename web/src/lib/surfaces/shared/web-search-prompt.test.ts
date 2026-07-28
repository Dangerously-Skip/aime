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
  const prompt = webSearchPrompt(false);

  it('does not claim a web_search tool the run does not have', () => {
    expect(prompt).not.toMatch(/web_search/);
    expect(prompt).not.toMatch(/ONLY search mechanism/);
  });

  it('points at WebFetch as the way to read a page', () => {
    expect(prompt).toMatch(/WebFetch is your web tool/);
    expect(prompt).toMatch(/whenever you have a URL/);
  });

  it('still forbids curl scraping — that part was never the problem', () => {
    expect(prompt).toMatch(/Do NOT use Bash with curl/);
    expect(prompt).toMatch(/Google, DuckDuckGo or Bing/);
  });

  it('gives an honest way out instead of leaving the model to guess', () => {
    expect(prompt).toMatch(/ask the user for a link/);
    expect(prompt).toMatch(/Do not claim to have searched/);
  });
});

describe('webSearchPrompt with the search MCP mounted', () => {
  const prompt = webSearchPrompt(true);

  it('keeps the original guidance verbatim', () => {
    expect(prompt).toMatch(/tool: web_search/);
    expect(prompt).toMatch(/ONLY search mechanism/);
    // The WebFetch restriction only makes sense when search results exist.
    expect(prompt).toMatch(/Do NOT use WebFetch to re-fetch URLs/);
  });
});

describe('the surfaces that carry the section', () => {
  it.each([
    ['cowork', getCoworkConfig],
    ['code', getCodeConfig],
  ])('%s tells the truth when nothing is mounted', (_name, get) => {
    vi.stubEnv('SEARXNG_INSTANCES', '');
    const prompt = promptOf(get());
    expect(prompt).toMatch(/WebFetch is your web tool/);
    expect(prompt).not.toMatch(/tool: web_search/);
  });

  it.each([
    ['cowork', getCoworkConfig],
    ['code', getCodeConfig],
  ])('%s restores the search guidance when it IS mounted', (_name, get) => {
    vi.stubEnv('SEARXNG_INSTANCES', 'https://searx.example');
    const prompt = promptOf(get());
    expect(prompt).toMatch(/tool: web_search/);
    expect(prompt).not.toMatch(/WebFetch is your web tool/);
  });

  it('leaves WebFetch in allowedTools either way — it was never the blocker', () => {
    vi.stubEnv('SEARXNG_INSTANCES', '');
    expect(getCoworkConfig().allowedTools).toContain('WebFetch');
    expect(getCodeConfig().allowedTools).toContain('WebFetch');
  });
});
