/**
 * A number you did not look up is a guess, and must be labelled one.
 *
 * WHAT THIS IS FOR, from a real run. Asked to research the market value of a set
 * of cameras, the agent produced a confident table of prices — sourced from its
 * own weights, never searched for, and wrong by three to four times. Everything
 * downstream was computed from those numbers, so the ROI ranking that was the
 * entire point of the task was worthless, and nothing about the output said so.
 *
 * That is the same disease as a harness session claiming "t-002 verified" with
 * no verifier attached: a claim with nothing behind it, presented exactly like a
 * claim with something behind it. Verification is the only reason to trust any
 * of this, and an unmarked guess spends that trust silently.
 *
 * WHY THIS IS PROMPT AND NOT ENFORCEMENT, said plainly. A prompt is guidance,
 * not a gate — this repo's own standard is that a control is only "enforced" if
 * disabling it fails a test. Nothing here refuses a turn. What it does is make
 * the honest option the obvious one and give the model the words for "I do not
 * know this", which it will otherwise not reach for. Evidence-bound verification
 * — the verifier checking that every cited URL was actually fetched during the
 * run — is the enforceable version and is a separate piece of work (DR-22 D-3).
 *
 * Kept in one file because the failure is not surface-specific: it happened on
 * Code, and Browser and Cowork do the same kind of research. Four copies would
 * drift, and `factual-claims.coverage.test.ts` derives the surface list from
 * source so a new one cannot quietly ship without it.
 */

export const FACTUAL_CLAIMS_PROMPT = `## Numbers need sources
Prices, market values, statistics, dates, version numbers and specifications go
stale and are exactly what you are least reliable about from memory. Recalling
one and presenting it as fact is the most damaging thing you can do here, because
everything computed from it inherits the error while looking just as confident.

So, for any figure that a decision depends on:
- **Look it up.** You have web search and, on the browser surface, the page
  itself. Use them before you answer, not after you are challenged.
- **Say where it came from** — the source and, where it matters, when it was
  from. "$605 (Coeln Cameras, sold listing)" is worth more than "$605".
- **Mark what you could not source.** "I could not find a current price for the
  Bessaflex TM; from memory it is roughly $300-400, unverified" is a good answer.
  A confident "$350" is not.

If a whole comparison rests on numbers you could not verify, say that about the
comparison, not just the numbers. A ranking built on guesses is a guess, however
carefully the arithmetic was done.`;

/** The fragment, for surfaces that compose their prompt from parts. */
export function factualClaimsPrompt(): string {
  return FACTUAL_CLAIMS_PROMPT;
}
