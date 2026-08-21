import { describe, it, expect } from 'vitest';
import { classifyBrowserRequest } from './request-shape';

/*
 * The two mistakes this classifier can make do not cost the same, so the suite
 * is not symmetric either.
 *
 * Sending a page question to the full agent costs a few seconds. Sending a GOAL
 * to the quick loop costs the whole task, silently — the reported failure that
 * started this work. So the load-bearing tests are the ones asserting `agent`,
 * and `quick-ask` has to be earned.
 */

const agent = (t: string) => expect(classifyBrowserRequest(t)).toBe('agent');
const quick = (t: string) => expect(classifyBrowserRequest(t)).toBe('quick-ask');

describe('goals route to the full agent', () => {
  it('routes the request that started all of this', () => {
    // The camera task: no file to write findings to, no table, no memory, no
    // connector — it could not have succeeded on the quick loop however good
    // the loop got.
    agent('inspect the camera listings across multiple pages, find the best ROI, give me the links');
  });

  it.each([
    'find me the cheapest flight to sydney',
    'compare the pricing on these three plans',
    'fill in this form with my details',
    'go to the docs and summarise the auth section',
    'search for reviews of this camera',
    'download the annual report',
    'save these results to a file',
    'open each of the top 5 results and tell me the prices',
    'check every listing for stock',
    'look up what this company does',
  ])('routes %j', agent);

  it('routes anything mentioning more than one page', () => {
    agent('what are the prices across all the listings?');
    agent('what is on the next page?');
    agent('which of these results is best?');
  });

  it('routes a multi-sentence brief even when it is short', () => {
    agent('Read the page. Then tell me the price. Then email it to me.');
  });

  it('routes a long request even with no action verb', () => {
    agent(
      'i am curious about whether the thing described on this page is similar to ' +
        'the other approach i was reading about earlier today which had a rather ' +
        'different set of tradeoffs around latency and cost and durability',
    );
  });

  it('routes a bare navigation request that reads like a noun phrase', () => {
    // Short, no action verb, one page, but not a question about what is on
    // screen — the fast path cannot see a page it has not opened.
    agent('the acme corp pricing page');
  });

  it('routes an empty or whitespace request rather than guessing', () => {
    agent('');
    agent('   ');
  });

  it('routes a question about something NOT on the current page', () => {
    quick('what does this page say about refunds?');
    agent('what does acme charge for the enterprise plan?');
  });
});

describe('page questions take the fast path', () => {
  it.each([
    'what is on this page?',
    'summarise this',
    'what does this say?',
    'tldr this article',
    'explain this table',
    'is this page about pricing?',
    'who wrote this?',
    'what is this?',
  ])('keeps %j local', quick);

  it('is case- and whitespace-insensitive', () => {
    quick('  WHAT IS ON THIS PAGE?  ');
  });
});

describe('word boundaries', () => {
  it('does not read an action verb inside another word', () => {
    // "finding" contains "find", "reorder" contains "order". Substring matching
    // would route both, and the fast path would go unused.
    quick('what is the main finding of this article?');
    quick('what is the reordering shown on this page?');
  });

  it('does not read "written" as the verb "write"', () => {
    quick('what is written on this page?');
  });

  it('still routes an inflected imperative, via a different gate', () => {
    // Whole-word matching misses "downloading". The not-a-question gate catches
    // it, which is the point of layering them — no single rule carries a goal.
    agent('downloading the annual report');
  });

  it('routes a question about this page that still asks for work', () => {
    // Where the verb list actually earns its place: everything else here says
    // quick-ask.
    agent('can you download this?');
  });
});
