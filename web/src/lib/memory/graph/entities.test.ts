import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractEntities, extractQueryEntities, normaliseEntityName } from './entities';

const mem = (content: string, tags: string[] = []) => ({ content, tags });
const ids = (content: string, tags: string[] = []) =>
  extractEntities(mem(content, tags)).map((e) => e.id).sort();

/**
 * Precision matters more than recall here. A wrong edge actively misleads
 * retrieval — surfacing memories about the wrong person — whereas a missing one
 * leaves retrieval no worse than the keyword-only behaviour it replaces. The
 * "does NOT invent" tests are therefore the important half.
 */

describe('extractEntities — people', () => {
  it('finds people from explicit relationship phrasing', () => {
    expect(ids('User works with Sarah on the payments team')).toContain('person:sarah');
    expect(ids('Reports to Mike Chen')).toContain('person:mike chen');
    expect(ids('Pairs with Ana Lopez on infra')).toContain('person:ana lopez');
  });

  it('finds people from a parenthesised role', () => {
    expect(ids('Sarah (designer) owns the design system')).toContain('person:sarah');
    expect(ids('Mike (PM) runs standup')).toContain('person:mike');
  });

  it('finds people from "X is the <role>"', () => {
    expect(ids('Priya is the engineering manager')).toContain('person:priya');
  });

  it('does NOT invent a person from a capitalised verb', () => {
    // "Chose Next.js over Remix" must not yield a person called Chose.
    expect(ids('Chose Next.js over Remix for the dashboard')).not.toContain('person:chose');
    expect(ids('Decided to use Postgres')).not.toContain('person:decided');
  });

  it('does not treat pronouns, days or months as people', () => {
    for (const word of ['They', 'Monday', 'March', 'User', 'This']) {
      expect(ids(`${word} works with the team`)).not.toContain(`person:${word.toLowerCase()}`);
    }
  });

  it('does not classify a technology as a person', () => {
    expect(ids('Works with Docker daily')).not.toContain('person:docker');
  });
});

describe('extractEntities — technologies', () => {
  it('finds technologies wherever they appear', () => {
    const found = ids('Prefers TypeScript with strict mode, and Postgres over MySQL');
    expect(found).toContain('technology:typescript');
    expect(found).toContain('technology:postgres');
    expect(found).toContain('technology:mysql');
  });

  it('handles names containing dots and pluses', () => {
    expect(ids('Uses Next.js on the frontend')).toContain('technology:next.js');
    expect(ids('Some C++ in the codec layer')).toContain('technology:c++');
  });

  it('is case-insensitive and strips trailing punctuation', () => {
    expect(ids('Likes REACT, and typescript.')).toEqual(
      expect.arrayContaining(['technology:react', 'technology:typescript']),
    );
  });

  it('does not match a technology name inside a longer word', () => {
    expect(ids('The gogo dancer')).not.toContain('technology:go');
  });
});

describe('extractEntities — organisations and tags', () => {
  it('finds an organisation after at/for', () => {
    expect(ids('User works at Acme Corp on payments')).toContain('organisation:acme');
  });

  it('promotes tags, which are the highest-quality signal available', () => {
    // Tags are curated by the user or the extractor rather than guessed.
    const found = ids('Anything', ['payments', 'typescript']);
    expect(found).toContain('topic:payments');
    expect(found).toContain('technology:typescript');
  });

  it('ignores empty and non-string tags', () => {
    expect(() => extractEntities({ content: 'x', tags: ['', null as unknown as string] })).not.toThrow();
    expect(ids('x', ['  '])).toEqual([]);
  });
});

describe('extractEntities — robustness', () => {
  it('deduplicates repeated mentions', () => {
    const found = extractEntities(mem('TypeScript and TypeScript and typescript'));
    expect(found.filter((e) => e.id === 'technology:typescript')).toHaveLength(1);
  });

  it('handles empty, missing and non-string content', () => {
    expect(extractEntities(mem(''))).toEqual([]);
    expect(extractEntities({ content: undefined as unknown as string, tags: [] })).toEqual([]);
    expect(extractEntities({ content: 'x', tags: undefined as unknown as string[] })).toEqual([]);
  });

  it('property: never throws, and every id is type-prefixed and normalised', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string()), (content, tags) => {
        const found = extractEntities({ content, tags });
        for (const e of found) {
          expect(e.id).toMatch(/^(person|technology|organisation|topic):/);
          const [, name] = e.id.split(/:(.+)/);
          expect(name).toBe(normaliseEntityName(name));
          expect(name.trim()).not.toBe('');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('property: ids are stable across whitespace and case differences', () => {
    fc.assert(
      fc.property(fc.constantFrom('TypeScript', 'typescript', '  TYPESCRIPT  '), (variant) => {
        expect(extractEntities(mem(`Uses ${variant} daily`)).map((e) => e.id)).toContain(
          'technology:typescript',
        );
      }),
      { numRuns: 50 },
    );
  });
});

describe('extractQueryEntities', () => {
  it('accepts a bare name, which memory extraction deliberately does not', () => {
    // A query rarely uses relationship phrasing. A wrong query entity only widens
    // the candidate set; a wrong STORED entity would pollute knowledge.
    expect(extractQueryEntities('what do I know about Sarah?').map((e) => e.id)).toContain(
      'person:sarah',
    );
  });

  it('still finds technologies and skips stopwords', () => {
    const found = extractQueryEntities('Which Postgres decisions did They make on Monday?').map((e) => e.id);
    expect(found).toContain('technology:postgres');
    expect(found).not.toContain('person:they');
    expect(found).not.toContain('person:monday');
  });

  it('returns nothing for an entity-free query', () => {
    expect(extractQueryEntities('what should i do next')).toEqual([]);
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.string(), (q) => {
        expect(() => extractQueryEntities(q)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});

/**
 * Regression: every ordinary instruction was read as naming a person, because a
 * bare `[A-Z][a-z]{2,}` was accepted unless it appeared in a stopword list of
 * pronouns, articles, days and months. "Can you write a summary" yielded
 * `person:can`. The consequence was not a wrong recall — those ids are not in the
 * graph, so they reach nothing — but a dead fast path: the graph was built and
 * discarded on essentially every message, and capitalisation alone decided
 * (0/20 sentence-capitalised prompts took the fast path, 20/20 lowercase ones did).
 *
 * Two rules replace the list. A capitalised FIRST word carries no evidence, since
 * every sentence capitalises its first word. And when the caller can say which
 * entities exist, that is the authoritative test of "is this a name" — no word
 * list can be.
 */
describe('extractQueryEntities — a sentence opener is not a person', () => {
  const OPENERS = [
    'Can you write a summary of the meeting',
    'Please refactor the retriever',
    'What is the status of the build',
    'Write me a report on memory',
    'Fix the failing test',
    'How do I run the tests',
    'Explain the graph module',
    'Should we ship this',
    'Let me see the diff',
    'Does the cache work',
    'Add a test for this',
    'Refactor the store',
    'Which decisions did we make',
  ];

  for (const prompt of OPENERS) {
    it(`finds no entity in ${JSON.stringify(prompt)}`, () => {
      expect(extractQueryEntities(prompt)).toEqual([]);
    });
  }

  it('also ignores an opener after sentence-ending punctuation or a quote', () => {
    expect(extractQueryEntities('Run the tests. Then explain the failure')).toEqual([]);
    expect(extractQueryEntities('"Write the docs" was the ask')).toEqual([]);
    expect(extractQueryEntities('Ship it!  Should we tag a release?')).toEqual([]);
  });

  it('still finds a name that is not the first word', () => {
    expect(extractQueryEntities('what do I know about Sarah?').map((e) => e.id)).toContain(
      'person:sarah',
    );
  });

  it('still finds technologies and organisations wherever they appear', () => {
    expect(extractQueryEntities('Postgres or MySQL for the ledger?').map((e) => e.id)).toEqual(
      expect.arrayContaining(['technology:postgres', 'technology:mysql']),
    );
    expect(extractQueryEntities('What did we ship at Acme Corp').map((e) => e.id)).toContain(
      'organisation:acme',
    );
  });
});

describe('extractQueryEntities — known entities are the authoritative test', () => {
  const known = new Set([
    'person:sarah',
    'topic:payments',
    'organisation:acme',
    'technology:postgres',
  ]);

  it('accepts a sentence-initial name the graph knows', () => {
    // Recovers the recall the position rule alone would cost.
    expect(extractQueryEntities('Sarah prefers Figma', known).map((e) => e.id)).toContain(
      'person:sarah',
    );
  });

  it('rejects a bare candidate the graph does not know, wherever it sits', () => {
    expect(extractQueryEntities('ask Barnaby about it', known).map((e) => e.id)).not.toContain(
      'person:barnaby',
    );
    expect(extractQueryEntities('Refactor the Widget please', known).map((e) => e.id)).toEqual([]);
  });

  it('matches a known entity of any type, not just people', () => {
    // A capitalised word matching a known topic or organisation is a real signal;
    // the old code could only ever produce `person:`.
    expect(extractQueryEntities('anything about Payments?', known).map((e) => e.id)).toContain(
      'topic:payments',
    );
    expect(extractQueryEntities('Acme rollout status', known).map((e) => e.id)).toContain(
      'organisation:acme',
    );
  });

  it('still returns relationship-phrased and technology entities with a known set', () => {
    const found = extractQueryEntities('who works with Sarah on Postgres', known).map((e) => e.id);
    expect(found).toContain('person:sarah');
    expect(found).toContain('technology:postgres');
  });

  it('never throws with a known set', () => {
    fc.assert(
      fc.property(fc.string(), (q) => {
        expect(() => extractQueryEntities(q, known)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});
