/**
 * Which loop should answer this?
 *
 * DR-22 D-1 keeps two paths on the Browser surface, split "by shape of request,
 * not by a toggle the user has to find":
 *
 *   - **quick ask** — *"what's on this page?"* Runs in the renderer against the
 *     raw Messages API with browser tools only. No round trip, sub-second, and
 *     the common case. Making it slower to make it more capable is a bad trade.
 *   - **full agent** — anything goal-shaped. Routes through the main chat path
 *     and inherits MCP, connectors, canvas, memory, skills and the harness.
 *
 * THE ASYMMETRY THAT SETS THE DEFAULT. These two mistakes do not cost the same.
 * A page question sent to the full agent costs a few seconds. A goal sent to the
 * quick loop costs the entire task, silently — that is the reported failure this
 * whole line of work exists to fix: an agent asked to compare camera listings
 * across pages could not write a file, build a table, or remember anything, so
 * it restated the same intent four times and ran out of iterations.
 *
 * So this is not a balanced classifier. **Full agent is the default**, and a
 * request has to look actively like a question about what is already on screen
 * to get the fast path. Read every rule below as answering "is there any reason
 * to think this needs more than the current page?" — and if there is, it routes.
 */

export type BrowserRequestShape = 'quick-ask' | 'agent';

/**
 * Verbs that mean "act", not "tell me". Any of these and it routes, regardless
 * of everything else — including `find`, which reads like a question but means
 * search-until-found, and was the first word of the failing camera request.
 */
const ACTION_VERBS = [
  'find', 'search', 'compare', 'collect', 'gather', 'buy', 'order', 'book',
  'fill', 'submit', 'sign up', 'log in', 'login', 'download', 'upload',
  'write', 'save', 'export', 'create', 'build', 'make', 'draft', 'send',
  'email', 'post', 'apply', 'browse', 'visit', 'go to', 'navigate', 'open',
  'click', 'scrape', 'extract all', 'monitor', 'track', 'watch', 'check every',
  'remember', 'add to', 'put in', 'cross-reference', 'look up', 'research',
];

/**
 * Phrases that anchor a request to what is already rendered. These are the ONLY
 * way onto the fast path.
 */
const THIS_PAGE = [
  'this page', 'the page', 'this site', 'this article', 'this post',
  'this form', 'this table', 'on screen', 'on the screen', 'here',
  'this', 'it', 'that',
];

/** Multiplicity: more than one page means the fast path cannot see the answer. */
const MULTI_PAGE = [
  'each', 'every', 'all the', 'across', 'multiple', 'several', 'these pages',
  'next page', 'other pages', 'first few', 'top ', 'best ', 'cheapest',
  'then ', ' and then', 'links', 'results',
];

/** A question about the page is short. A goal is usually not. */
const QUICK_ASK_WORD_LIMIT = 25;

const has = (haystack: string, needles: string[]): boolean =>
  needles.some((n) => haystack.includes(n));

/**
 * Classify a request.
 *
 * Pure and synchronous on purpose. An LLM classifier would be more accurate and
 * would also add a round trip to the path whose entire justification is not
 * having one — and it would be wrong sometimes too, just less legibly.
 */
export function classifyBrowserRequest(text: string): BrowserRequestShape {
  const t = text.toLowerCase().trim();
  if (!t) return 'agent';

  // Anything spanning more than one page is beyond what the fast path can see.
  if (has(t, MULTI_PAGE)) return 'agent';

  /*
   * An imperative asking for work, wherever it appears in the sentence.
   *
   * Matched as a WHOLE WORD at both ends, so the noun "finding" does not trip
   * `find` and "reordering" does not trip `order`. That means inflections are
   * missed — "downloading the report" does not match `download` — and it is fine
   * that they are: this list is only consulted after multiplicity and length
   * have already passed, and an inflected imperative is not question-shaped, so
   * the `isQuestion` gate below routes it anyway. Where the list actually earns
   * its place is a request that IS a question about this page and still asks for
   * work: "can you download this?"
   */
  if (ACTION_VERBS.some((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t))) {
    return 'agent';
  }

  // Long enough to be a brief rather than a question.
  if (t.split(/\s+/).length > QUICK_ASK_WORD_LIMIT) return 'agent';

  // Several sentences is a plan, even a short one.
  if ((t.match(/[.!?]\s+\S/g) ?? []).length >= 2) return 'agent';

  /*
   * What is left: short, single-sentence, no action verb, one page. That still
   * is not enough — it must be a QUESTION, and one anchored to what is on
   * screen. "the acme corp pricing page" passes everything above and is a
   * navigation request, not a question about the current page.
   */
  const isQuestion = t.endsWith('?') || /^(what|who|when|where|why|how|which|is|are|does|do|can|did|was|were)\b/.test(t);
  const isSummarise = /^(summari[sz]e|tldr|tl;dr|explain|describe|read)\b/.test(t);
  if (!isQuestion && !isSummarise) return 'agent';

  return has(t, THIS_PAGE) ? 'quick-ask' : 'agent';
}
