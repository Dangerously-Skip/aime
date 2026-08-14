import { describe, it, expect } from 'vitest';
import { parseSearchWebResults, isParsableSearchTool } from './parse-results';

/**
 * The sidebar used to re-run every search to fill its card. Free against a
 * self-hosted SearXNG; a doubled bill the moment the gate covered the paid
 * providers — twelve agent searches became twenty-four billable queries, and
 * the card could show a different result set than the model reasoned over.
 */
const OUTPUT = [
  '1. Parklea house prices',
  '   https://example.com/parklea',
  '   Median prices rose 6% year on year.',
  '',
  '2. Western Sydney outlook',
  '   https://other.example/outlook',
  '   Infrastructure is the main driver.',
].join('\n');

describe('parseSearchWebResults', () => {
  it('reads what the tool returned', () => {
    expect(parseSearchWebResults(OUTPUT)).toEqual([
      { title: 'Parklea house prices', url: 'https://example.com/parklea', snippet: 'Median prices rose 6% year on year.' },
      { title: 'Western Sydney outlook', url: 'https://other.example/outlook', snippet: 'Infrastructure is the main driver.' },
    ]);
  });

  it('joins a snippet that wrapped across lines', () => {
    const wrapped = '1. Title\n   https://x.com/a\n   first half\n   second half';
    expect(parseSearchWebResults(wrapped)[0].snippet).toBe('first half second half');
  });

  it('tolerates a missing snippet', () => {
    expect(parseSearchWebResults('1. Title\n   https://x.com/a')).toEqual([
      { title: 'Title', url: 'https://x.com/a', snippet: '' },
    ]);
  });

  /* The tool's own sentinel for a real empty result set — not an error. */
  it('returns nothing for the empty-result message', () => {
    expect(parseSearchWebResults('No results for "zzz". This is a real empty result set, not an error.')).toEqual([]);
  });

  it.each([
    ['a failure message', 'Search FAILED (auth). Results are unavailable.'],
    ['empty', ''],
    ['whitespace', '   '],
    ['prose with no entries', 'I could not find anything useful.'],
  ])('returns nothing for %s', (_label, text) => {
    expect(parseSearchWebResults(text)).toEqual([]);
  });

  it.each([null, undefined, 42, {}])('survives the non-string %p', (bad) => {
    expect(parseSearchWebResults(bad)).toEqual([]);
  });

  it('skips an entry with no URL rather than inventing one', () => {
    expect(parseSearchWebResults('1. Title only\n   no link here')).toEqual([]);
  });
});

describe('isParsableSearchTool', () => {
  it.each(['mcp__aime__SearchWeb', 'SearchWeb', 'WebSearch'])('claims %s', (n) => {
    expect(isParsableSearchTool(n)).toBe(true);
  });

  /* The external searxng MCP returns its own shape and is free to re-query, so
   * the sidebar keeps its proxy call for that one. */
  it.each(['mcp__web-search__web_search', 'searxng_search', 'Read', null])('does not claim %p', (n) => {
    expect(isParsableSearchTool(n)).toBe(false);
  });
});
