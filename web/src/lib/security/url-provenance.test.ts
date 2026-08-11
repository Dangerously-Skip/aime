import { describe, it, expect } from 'vitest';
import { UrlProvenance, extractUrls, normalizeUrl, isUrlFetchTool } from './url-provenance';

/**
 * The reproduction is the spec.
 *
 * These are the exact URLs the agent invented when asked for "the top pizza
 * places in western sydney" with no search provider configured — it announced
 * they were "predictable patterns", fetched six in parallel, got 404s, and moved
 * on to "let me try a few more approaches". Every one of them must be refused,
 * and the first search result must be fetchable, or the guard has not replaced
 * the behaviour it exists to replace.
 */
const INVENTED = [
  'https://www.broadsheet.com.au/sydney/food-and-drink/article/best-pizza-western-sydney',
  'https://www.timeout.com/sydney/restaurants/best-pizza-in-sydney',
  'https://www.concreteplayground.com/sydney/food-drink/best-pizza-western-sydney',
  'https://www.goodfood.com.au/sydney/best-pizza-western-sydney',
];

describe('normalizeUrl', () => {
  it('compares on scheme + host + path', () => {
    expect(normalizeUrl('https://Example.COM/a/b')).toBe('https://example.com/a/b');
  });

  it('ignores trailing slash, query and fragment', () => {
    const base = normalizeUrl('https://example.com/a');
    expect(normalizeUrl('https://example.com/a/')).toBe(base);
    expect(normalizeUrl('https://example.com/a?utm_source=x')).toBe(base);
    expect(normalizeUrl('https://example.com/a#section')).toBe(base);
  });

  it('rejects non-http schemes and junk', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('extractUrls', () => {
  it('finds urls in prose and drops trailing punctuation', () => {
    expect(extractUrls('See https://example.com/a, and https://example.com/b.')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('handles the shape a search result actually returns', () => {
    const results = [
      '1. Best Pizza in Sydney',
      '   https://www.timeout.com/sydney/restaurants/best-pizza',
      '   Our guide to the city’s best.',
    ].join('\n');
    expect(extractUrls(results)).toContain('https://www.timeout.com/sydney/restaurants/best-pizza');
  });

  it('returns nothing for text with no urls', () => {
    expect(extractUrls('no links here')).toEqual([]);
  });
});

describe('the guessing run that motivated this', () => {
  it.each(INVENTED)('refuses the invented URL %s', (url) => {
    const p = new UrlProvenance(['search for the top pizza places in western sydney']);
    const v = p.check(url);
    expect(v.allowed).toBe(false);
    expect(v.message).toMatch(/did not come from anywhere/);
  });

  /**
   * Refusing is only half of it. The refusal has to close off the behaviour the
   * transcript shows — trying variants, then a different publisher — or the
   * model simply loops against the guard.
   */
  it('tells the model not to try variants or another publisher', () => {
    const p = new UrlProvenance(['find me pizza']);
    const msg = p.check(INVENTED[0]).message!;
    expect(msg).toMatch(/Do not try variants/i);
    expect(msg).toMatch(/different publisher/i);
    expect(msg).toMatch(/unverified/);
  });

  it('a same-host guess is still a guess', () => {
    // The exact vector: the host was real and seen; the path was invented.
    const p = new UrlProvenance(['read https://www.broadsheet.com.au/sydney']);
    expect(p.check('https://www.broadsheet.com.au/sydney/food-and-drink/article/best-pizza').allowed).toBe(
      false,
    );
  });
});

describe('what a URL is allowed to come from', () => {
  it('a link the user pasted', () => {
    const p = new UrlProvenance(['have a look at https://example.com/menu please']);
    expect(p.check('https://example.com/menu').allowed).toBe(true);
  });

  it('earlier conversation history', () => {
    const p = new UrlProvenance([null, 'earlier we discussed https://example.com/a', undefined]);
    expect(p.check('https://example.com/a').allowed).toBe(true);
  });

  /**
   * The one that makes search worth configuring: results arrive mid-turn and
   * must become fetchable, or the search → read loop cannot complete.
   */
  it('a result returned by a tool during this turn', () => {
    const p = new UrlProvenance(['best pizza in sydney']);
    expect(p.check('https://www.timeout.com/sydney/restaurants/best-pizza').allowed).toBe(false);

    p.record('1. Best Pizza\n   https://www.timeout.com/sydney/restaurants/best-pizza\n   guide');
    expect(p.check('https://www.timeout.com/sydney/restaurants/best-pizza').allowed).toBe(true);
  });

  it('tolerates tracking params added to a seen url', () => {
    const p = new UrlProvenance(['https://example.com/a']);
    expect(p.check('https://example.com/a?utm_source=chat').allowed).toBe(true);
  });
});

describe('the guard stays out of the way where it cannot help', () => {
  it('passes through a non-string or empty url rather than inventing a refusal', () => {
    const p = new UrlProvenance([]);
    expect(p.check(undefined).allowed).toBe(true);
    expect(p.check(42).allowed).toBe(true);
    expect(p.check('').allowed).toBe(true);
  });

  it('passes through something that is not a parseable url', () => {
    expect(new UrlProvenance([]).check('./relative/path').allowed).toBe(true);
  });

  it('says so plainly when no URLs exist at all', () => {
    const msg = new UrlProvenance([]).check('https://example.com/x').message!;
    expect(msg).toMatch(/No URLs have been seen/);
  });
});

describe('isUrlFetchTool', () => {
  it('matches WebFetch however it is namespaced', () => {
    expect(isUrlFetchTool('WebFetch')).toBe(true);
    expect(isUrlFetchTool('mcp__something__web_fetch')).toBe(true);
  });

  it('does not match unrelated tools', () => {
    for (const t of ['Read', 'Bash', 'mcp__aime__SearchWeb', 'WebSearch']) {
      expect(isUrlFetchTool(t), t).toBe(false);
    }
  });
});

/**
 * URLs wrapped in prose, which is how they arrive.
 *
 * `URL_RE` used to exclude `)` outright, so every Wikipedia-style address was
 * truncated at the first paren: the guard recorded `…/Foo_(bar` and then
 * refused the real `…/Foo_(bar)` the model went on to fetch — which reads as
 * FetchUrl randomly rejecting a link the search had just returned.
 *
 * A trailing paren is genuinely ambiguous, so it is decided by BALANCE. This
 * block is the regression test the fix shipped without.
 */
describe('a URL with parentheses in its path', () => {
  const WIKI = 'https://en.wikipedia.org/wiki/Nice_(disambiguation)';

  it('extracts it whole', () => {
    expect(extractUrls(`See ${WIKI} for more.`)).toContain(WIKI);
  });

  it('records it so the matching fetch is allowed', () => {
    const p = new UrlProvenance([`have a look at ${WIKI}`]);
    expect(p.check(WIKI).allowed, 'the URL was truncated on the way in').toBe(true);
  });

  it('still strips a paren that only wraps the URL', () => {
    const plain = 'https://example.com/a';
    expect(extractUrls(`(see ${plain})`)).toContain(plain);
    expect(extractUrls(`(see ${plain})`)).not.toContain(`${plain})`);
  });

  it('handles a wrapped URL that itself ends in a paren', () => {
    expect(extractUrls(`(see ${WIKI})`)).toContain(WIKI);
  });

  it('keeps nested parens balanced', () => {
    const nested = 'https://example.com/a_(b_(c))';
    expect(extractUrls(`ref: ${nested}`)).toContain(nested);
  });

  it.each([
    ['a full stop', 'https://example.com/a.'],
    ['a comma', 'https://example.com/a,'],
    ['a semicolon', 'https://example.com/a;'],
    ['a question mark at the end of a sentence', 'https://example.com/a?'],
    ['several at once', 'https://example.com/a).,'],
  ])('trims %s', (_label, written) => {
    expect(extractUrls(`link: ${written}`)).toContain('https://example.com/a');
  });

  it('does not treat a paren-only tail as part of the path', () => {
    expect(extractUrls('(https://example.com/a)')).toEqual(['https://example.com/a']);
  });
});

/**
 * The rest of `extractUrls`, which had no direct coverage — mutation testing
 * reported 15 mutants in this file with no test touching them at all.
 */
describe('extractUrls', () => {
  it('de-duplicates by normalised form', () => {
    expect(
      extractUrls('https://Example.com/a/ and https://example.com/a again'),
    ).toEqual(['https://example.com/a']);
  });

  it('finds several distinct URLs', () => {
    const out = extractUrls('one https://a.com/x two http://b.com/y three');
    expect(out).toHaveLength(2);
  });

  it.each(['', '   ', 'no urls here at all', 'ftp://example.com/a', 'mailto:a@b.com'])(
    'returns nothing for %p',
    (text) => {
      expect(extractUrls(text)).toEqual([]);
    },
  );

  it('is not fooled by a URL inside markup', () => {
    expect(extractUrls('<a href="https://example.com/a">x</a>')).toContain('https://example.com/a');
  });

  it('never throws, whatever the text', () => {
    for (const s of ['((((', 'https://', 'https://)))', '(https://a.com/(']) {
      expect(() => extractUrls(s)).not.toThrow();
    }
  });
});
