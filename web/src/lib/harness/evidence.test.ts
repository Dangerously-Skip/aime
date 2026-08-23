import { describe, it, expect } from 'vitest';
import {
  normaliseUrl,
  extractUrls,
  RetrievalLog,
  unretrievedCitations,
  citationFailure,
} from './evidence';
import { createVerifier } from './verifier';
import { createSessionRunner } from './session';

/**
 * A CITATION MUST POINT AT SOMETHING THE RUN ACTUALLY FETCHED.
 *
 * The verifier already refuses a pass with no evidence. But the evidence is free
 * text the verifier wrote, so the one control between a claim and the ledger
 * could be satisfied by a plausible-looking URL the run had never opened.
 *
 * That is the failure that happened: market values recalled from model weights,
 * wrong by three to four times, with the entire ROI ranking computed from them.
 * A verifier asked to check that work would have been shown citations of exactly
 * the same shape as real ones.
 */

describe('normalising, so a real citation is not rejected for punctuation', () => {
  it.each([
    ['https://Example.com/Item', 'https://example.com/Item'],
    ['https://www.example.com/item', 'https://example.com/item'],
    ['https://example.com/item/', 'https://example.com/item'],
    ['https://example.com/item#specs', 'https://example.com/item'],
    ['https://example.com/item?utm_source=x', 'https://example.com/item'],
    ['https://example.com/item?id=7&utm_medium=y', 'https://example.com/item?id=7'],
  ])('%s → %s', (raw, want) => {
    expect(normaliseUrl(raw)).toBe(want);
  });

  it('keeps path case, because paths are case-sensitive', () => {
    // A gate that conflates /Item and /item lets a different page through.
    expect(normaliseUrl('https://example.com/Item')).not.toBe(normaliseUrl('https://example.com/item'));
  });

  it('refuses non-http schemes and nonsense', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url', '']) {
      expect(normaliseUrl(bad)).toBeNull();
    }
  });

  it('strips trailing punctuation from prose', () => {
    // "see https://example.com/item." is how a citation actually arrives.
    expect(normaliseUrl('https://example.com/item.')).toBe('https://example.com/item');
    expect(extractUrls('sold here: https://example.com/a, and https://example.com/b.'))
      .toEqual(['https://example.com/a', 'https://example.com/b']);
  });
});

describe('the retrieval log', () => {
  it('records a URL from a tool input', () => {
    const log = new RetrievalLog();
    log.recordFrom(JSON.stringify({ url: 'https://coeln.com/nikon-fm' }));
    expect(log.has('https://coeln.com/nikon-fm')).toBe(true);
  });

  it('records URLs that only appear in a RESULT', () => {
    /*
     * A search names pages the run never typed itself, and reading one of those
     * is exactly as much "the run saw this page" as navigating to it.
     */
    const log = new RetrievalLog();
    log.recordFrom('1. Nikon FM — https://ebay.com/itm/123\n2. Other — https://dpreview.com/x');
    expect(log.has('https://ebay.com/itm/123')).toBe(true);
    expect(log.has('https://dpreview.com/x')).toBe(true);
  });

  it('matches across cosmetic differences', () => {
    const log = new RetrievalLog();
    log.record('https://www.Example.com/Item/');
    expect(log.has('https://example.com/Item#gallery')).toBe(true);
  });

  it('does not match a different page on the same host', () => {
    const log = new RetrievalLog();
    log.record('https://example.com/item-a');
    expect(log.has('https://example.com/item-b')).toBe(false);
  });
});

describe('judging a set of citations', () => {
  const log = new RetrievalLog();
  log.recordFrom('https://coeln.com/nikon-fm https://ebay.com/itm/123');

  it('passes citations that were fetched', () => {
    expect(unretrievedCitations(['Sold for $605 — https://coeln.com/nikon-fm'], log)).toEqual([]);
  });

  it('names citations that were not', () => {
    const bad = unretrievedCitations(
      ['Sold $605 — https://coeln.com/nikon-fm', 'Listed £300 — https://picclick.co.uk/made-up'],
      log,
    );
    expect(bad).toEqual(['https://picclick.co.uk/made-up']);
  });

  it('is silent about evidence with no URLs in it', () => {
    // "ran ./check.sh, exit 0" is perfectly good evidence and cites nothing.
    expect(unretrievedCitations(['ran ./check.sh, exit 0', 'tests: 12 passed'], log)).toEqual([]);
  });

  it('explains itself in terms the model can act on', () => {
    const msg = citationFailure(['https://picclick.co.uk/made-up']);
    expect(msg).toMatch(/never retrieved/i);
    expect(msg).toMatch(/fetch it and re-check|drop the claim/i);
  });
});

describe('the verifier refuses a pass built on an unfetched citation', () => {
  /** A verifier whose model returns the given verdict JSON. */
  const verifierReturning = (verdict: unknown, log?: RetrievalLog) =>
    createVerifier({
      treeFingerprint: async () => '',
      retrieved: log ? () => log : undefined,
      query: async function* () {
        yield { type: 'text', content: JSON.stringify(verdict) };
      },
    });

  const goal = { objective: 'price the cameras' } as never;
  const task = { id: 't-1', title: 'price them', verify: ['prices are sourced'] } as never;

  it('passes when every citation was fetched', async () => {
    const log = new RetrievalLog();
    log.record('https://coeln.com/nikon-fm');
    const v = await verifierReturning(
      { passed: true, missing: [], evidence: ['$605 sold — https://coeln.com/nikon-fm'] },
      log,
    )(goal, task, 'did it');
    expect(v.passed).toBe(true);
  });

  it('FAILS a pass citing a URL the run never fetched', async () => {
    /*
     * The load-bearing test, and the whole point of the feature: a confident
     * claim dressed in a plausible URL is exactly what the old gate accepted.
     */
    const log = new RetrievalLog();
    log.record('https://coeln.com/nikon-fm');
    const v = await verifierReturning(
      { passed: true, missing: [], evidence: ['$350 market value — https://invented.example/price'] },
      log,
    )(goal, task, 'did it');
    expect(v.passed).toBe(false);
    expect(v.missing.join(' ')).toMatch(/never retrieved/i);
    expect(v.missing.join(' ')).toContain('https://invented.example/price');
  });

  it('keeps the evidence on the failed verdict, so the user can see the claim', async () => {
    const log = new RetrievalLog();
    const v = await verifierReturning(
      { passed: true, missing: [], evidence: ['made up — https://invented.example/x'] },
      log,
    )(goal, task, 'did it');
    expect(v.evidence.join(' ')).toContain('invented.example');
  });

  it('does not run the check when there is no log — a local task fetches nothing', async () => {
    // "make ./check.sh pass" has no retrieval, and demanding one would fail
    // every local task. The no-evidence rule still applies underneath.
    const v = await verifierReturning({
      passed: true, missing: [], evidence: ['ran ./check.sh, exit 0'],
    })(goal, task, 'did it');
    expect(v.passed).toBe(true);
  });

  it('does not pile a citation complaint onto an already-failing verdict', async () => {
    const log = new RetrievalLog();
    const v = await verifierReturning(
      { passed: false, missing: ['prices are not sourced'], evidence: ['https://invented.example/x'] },
      log,
    )(goal, task, 'did it');
    expect(v.passed).toBe(false);
    expect(v.missing).toEqual(['prices are not sourced']);
  });
});

describe('the session actually feeds the log — the half that was untested', () => {
  /*
   * Removing the session's recording left every test above passing, because
   * they build the log by hand. The gate is only worth anything if the run's
   * own tool calls populate it, so this drives the REAL session runner.
   */
  const input = (dir: string) => ({
    dir, sessionIndex: 1, missing: [], budgetRemainingUsd: null,
    goal: { objective: 'x', acceptanceCriteria: ['ok'] },
    task: { id: 't-1', title: 'do it', status: 'doing', verify: ['ok'] },
  }) as never;

  it('records the URL a tool names in its INPUT', async () => {
    const log = new RetrievalLog();
    const run = createSessionRunner({
      chatId: 'c', cwd: '/tmp', maxTurns: 5,
      onRetrieval: (t) => log.recordFrom(t),
      query: async function* () {
        yield { type: 'tool_use', name: 'navigate', input: { url: 'https://coeln.com/nikon-fm' } };
        yield { type: 'text', content: 'done' };
      },
    });
    await run(input('/tmp'));
    expect(log.has('https://coeln.com/nikon-fm')).toBe(true);
  });

  it('records URLs that only appear in a RESULT', async () => {
    const log = new RetrievalLog();
    const run = createSessionRunner({
      chatId: 'c', cwd: '/tmp', maxTurns: 5,
      onRetrieval: (t) => log.recordFrom(t),
      query: async function* () {
        yield { type: 'tool_use', name: 'SearchWeb', input: { query: 'nikon fm price' } };
        /*
         * `result`, which is what the provider actually yields. This said
         * `content`, matching the bug in session.ts rather than the provider —
         * so both agreed and nothing from a tool's ANSWER was ever logged.
         */
        yield { type: 'tool_result', result: '1. https://ebay.com/itm/123\n2. https://dpreview.com/x' };
        yield { type: 'text', content: 'done' };
      },
    });
    await run(input('/tmp'));
    expect(log.has('https://ebay.com/itm/123')).toBe(true);
    expect(log.has('https://dpreview.com/x')).toBe(true);
  });

  it('a run that fetched nothing logs nothing', async () => {
    // So the verifier's "no log means no check" branch is reachable honestly.
    const log = new RetrievalLog();
    const run = createSessionRunner({
      chatId: 'c', cwd: '/tmp', maxTurns: 5,
      onRetrieval: (t) => log.recordFrom(t),
      query: async function* () {
        yield { type: 'tool_use', name: 'Bash', input: { command: './check.sh' } };
        yield { type: 'tool_result', result: 'exit 0' };
        yield { type: 'text', content: 'done' };
      },
    });
    await run(input('/tmp'));
    expect(log.size).toBe(0);
  });
});
