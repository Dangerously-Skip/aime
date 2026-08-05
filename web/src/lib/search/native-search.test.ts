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
  const noSearch = `You are AIME.\n\n${webSearchPrompt(false)}`;
  const withSearch = `You are AIME.\n\n${webSearchPrompt(true)}`;

  it('upgrades a no-search prompt when search turns out to exist', () => {
    const out = correctWebSearchSection(noSearch, true);
    expect(out).toContain('You have web search available');
    expect(out).not.toContain('There is NO search engine available');
    expect(out.startsWith('You are AIME.')).toBe(true);
  });

  it('downgrades a search prompt when there is none', () => {
    const out = correctWebSearchSection(withSearch, false);
    expect(out).toContain('There is NO search engine available');
    expect(out).not.toContain('You have web search available');
  });

  it('is a no-op when the prompt already matches', () => {
    expect(correctWebSearchSection(withSearch, true)).toBe(withSearch);
    expect(correctWebSearchSection(noSearch, false)).toBe(noSearch);
  });

  /**
   * Exact-match by construction: both strings come from the same module, so a
   * prompt without either branch is left completely alone rather than mangled.
   */
  it('leaves an unrelated prompt untouched', () => {
    const other = 'You are a helpful assistant with no web section at all.';
    expect(correctWebSearchSection(other, true)).toBe(other);
  });
});
