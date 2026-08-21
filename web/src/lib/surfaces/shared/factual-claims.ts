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

/**
 * When a surface has a live browser, say so and say when to reach for it.
 *
 * OBSERVED, not theorised. A Code run with the preview panel open was OFFERED
 * the browser tools and barely touched them: 5 `navigate` against 83 `Bash` and
 * 19 `FetchUrl`, on a task that was entirely about reading listing pages. The
 * tools were registered, permitted and working — and the prompt never mentioned
 * they existed or when they would beat a fetch.
 *
 * The Browser surface has this guidance already ("Which tool reads a page") and
 * it is the reason that surface reaches for the right one. Code and Cowork had
 * nothing, so the model defaulted to what it always has: shell and fetch.
 *
 * ONLY EMITTED WHEN THE TOOLS ARE ACTUALLY THERE. Naming a tool that is not
 * registered is the trap this codebase keeps falling into — an agent told it can
 * navigate, on a run with no webview, cannot discover the step is impossible and
 * repeats it (DR-21). The caller passes what it knows.
 */
export function browserToolsPrompt(available: boolean): string {
  if (!available) return '';
  return `## You have a real browser open
Alongside fetching, you can drive an actual browser view: \`navigate\`, \`snapshot\`,
\`click\`, \`type_text\`, \`scroll\`, \`extract_content\`. This is not a slower FetchUrl —
it is the only way to reach anything a fetch cannot see.

Prefer the browser when the page needs a SESSION or an INTERACTION: results behind
a login, a filter or sort you have to apply, pagination driven by clicks, prices
that only appear after the page's own scripts run, anything where a raw fetch
returns a shell with no content in it.

Prefer \`FetchUrl\` when the page is static and you only need its text — it is
faster and cheaper, and most documentation and articles are exactly that.

To act on a page: \`snapshot\` first. It returns the page's structure with a \`ref\`
on every element you can touch, and the acting tools take those refs. Refs expire
the moment the page changes, so re-snapshot after anything that moves it.`;
}

/** The fragment, for surfaces that compose their prompt from parts. */
export function factualClaimsPrompt(): string {
  return FACTUAL_CLAIMS_PROMPT;
}
