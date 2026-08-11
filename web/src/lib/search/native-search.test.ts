import { describe, it, expect } from 'vitest';
import { supportsNativeWebSearch } from './native-search';
import { webSearchPrompt, correctWebSearchSection } from '@/lib/surfaces/shared/web-search-prompt';

/**
 * The SDK's built-in `WebSearch` was denied on every run since the app was
 * written, with no condition and no comment. It is a real first-class tool in
 * `sdk-tools.d.ts` and was in this app's original default tool list.
 *
 * The deny was correct once: `WebSearch` is Anthropic's SERVER-SIDE search, so
 * it exists only where the provider implements it, and this app began life
 * behind a corporate gateway that did not. It stopped being correct the moment
 * anyone pointed it at a first-party key — at which point we were switching off
 * a free, zero-config capability and then telling the user to self-host SearXNG.
 *
 * These pin which backends get it, because the two failure directions are both
 * bad: withholding it wastes a capability, and offering it where the backend
 * cannot serve it hands the model a tool that errors — the "claims a tool it
 * does not have" bug that produced the URL-guessing in the first place.
 */

describe('supportsNativeWebSearch', () => {
  it('is on for a plain first-party run', () => {
    expect(supportsNativeWebSearch({})).toBe(true);
  });

  it('is on for Vertex, which serves it', () => {
    expect(supportsNativeWebSearch({ providerEnv: { CLAUDE_CODE_USE_VERTEX: '1' } })).toBe(true);
  });

  it('is OFF for Bedrock, which does not', () => {
    expect(supportsNativeWebSearch({ providerEnv: { CLAUDE_CODE_USE_BEDROCK: '1' } })).toBe(false);
  });

  /**
   * The case that matters for this user. OpenRouter proxies the Messages API
   * but does not execute Anthropic's server-side tools — it has its own web
   * plugin instead, which is what the `openrouter` SEARCH provider uses. Two
   * different mechanisms; only one of them is `WebSearch`.
   */
  it('is OFF behind any custom base URL — OpenRouter, a gateway, the shim', () => {
    expect(supportsNativeWebSearch({ baseUrl: 'https://openrouter.ai/api/v1' })).toBe(false);
    expect(supportsNativeWebSearch({ baseUrl: 'http://localhost:4000' })).toBe(false);
  });

  it('ignores a blank base URL rather than treating it as an override', () => {
    expect(supportsNativeWebSearch({ baseUrl: '   ' })).toBe(true);
  });
});

/**
 * The prompt has to agree with the tools. Telling a model it has no search
 * while mounting one is the same defect as the reverse, and the reverse is what
 * sent it inventing URLs.
 */
describe('correctWebSearchSection', () => {
  const noSearch = `You are AIME.\n\n${webSearchPrompt('none')}`;
  const withSearch = `You are AIME.\n\n${webSearchPrompt('mcp-searxng')}`;

  it('upgrades a no-search prompt when search turns out to exist', () => {
    const out = correctWebSearchSection(noSearch, 'mcp-searxng');
    expect(out).toContain('You have web search available');
    expect(out).not.toContain('There is NO search engine available');
    expect(out.startsWith('You are AIME.')).toBe(true);
  });

  it('downgrades a search prompt when there is none', () => {
    const out = correctWebSearchSection(withSearch, 'none');
    expect(out).toContain('There is NO search engine available');
    expect(out).not.toContain('You have web search available');
  });

  it('is a no-op when the prompt already matches', () => {
    expect(correctWebSearchSection(withSearch, 'mcp-searxng')).toBe(withSearch);
    expect(correctWebSearchSection(noSearch, 'none')).toBe(noSearch);
  });

  /**
   * Exact-match by construction: both strings come from the same module, so a
   * prompt without either branch is left completely alone rather than mangled.
   */
  it('leaves an unrelated prompt untouched', () => {
    const other = 'You are a helpful assistant with no web section at all.';
    expect(correctWebSearchSection(other, 'mcp-searxng')).toBe(other);
  });
});

/**
 * The two inputs this predicate could not see, each of which handed the model a
 * tool the run could not use.
 */
describe('supportsNativeWebSearch and the paths it was blind to', () => {
  it('refuses the AMBIENT Bedrock setup', () => {
    // No BYOK row selected, so `resolveExecution` returns no env and no
    // baseUrl — but the provider routes the subprocess through Bedrock anyway.
    expect(
      supportsNativeWebSearch({ ambientBedrock: true }),
      'WebSearch would be offered on Bedrock, which does not implement it',
    ).toBe(false);
  });

  it('still allows the first-party API when Bedrock is not configured', () => {
    expect(supportsNativeWebSearch({ ambientBedrock: false })).toBe(true);
    expect(supportsNativeWebSearch({})).toBe(true);
  });

  it('honours an explicit "No search"', () => {
    expect(
      supportsNativeWebSearch({ userDeclinedSearch: true }),
      'the off-switch switched nothing off',
    ).toBe(false);
  });

  it('lets "No search" beat every capability check', () => {
    expect(supportsNativeWebSearch({ userDeclinedSearch: true, providerEnv: { CLAUDE_CODE_USE_VERTEX: '1' } })).toBe(false);
  });

  it('keeps the explicit provider env authoritative over the ambient guess', () => {
    // A selected Vertex row on a machine that also has AWS credentials lying
    // around: the row wins, because that is what the subprocess will use.
    expect(
      supportsNativeWebSearch({ providerEnv: { CLAUDE_CODE_USE_VERTEX: '1' }, ambientBedrock: true }),
    ).toBe(true);
  });
});

/**
 * The prompt has to name the tool that is actually mounted.
 *
 * The "available" branch was hardcoded to the SearXNG MCP, which is mounted
 * only for searxng — so a Tavily user was told to call `web_search`, got "No
 * such tool available", and was forbidden in the same paragraph from using the
 * `SearchWeb` that WAS mounted.
 */
describe('webSearchPrompt names the mounted tool', () => {
  it.each([
    ['mcp-searxng', 'web_search'],
    ['aime-searchweb', 'SearchWeb'],
    ['native', 'WebSearch'],
  ] as const)('%s tells the model to call %s', (kind, name) => {
    const prompt = webSearchPrompt(kind);
    expect(prompt).toContain(`tool: \`${name}\``);
  });

  it.each([
    ['mcp-searxng', ['SearchWeb', 'WebSearch']],
    ['aime-searchweb', ['web_search', 'WebSearch']],
    ['native', ['web_search', 'SearchWeb']],
  ] as const)('%s says the others are not mounted', (kind, absent) => {
    const prompt = webSearchPrompt(kind);
    for (const other of absent) {
      expect(prompt, `${other} was not ruled out`).toContain(`\`${other}\``);
    }
    expect(prompt).toMatch(/are NOT mounted/);
  });

  it('swaps between any two variants, not just on/off', () => {
    const baked = `You are AIME.\n\n${webSearchPrompt('mcp-searxng')}`;
    const corrected = correctWebSearchSection(baked, 'aime-searchweb');
    expect(corrected).toContain('tool: `SearchWeb`');
    expect(corrected).not.toContain('tool: `web_search`');
  });

  it('leaves a prompt it does not recognise alone', () => {
    const other = 'You are AIME.\n\n## Web search\nSomething hand-written.';
    expect(correctWebSearchSection(other, 'native')).toBe(other);
  });
});
