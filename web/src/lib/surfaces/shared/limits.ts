/**
 * What actually bounds a run, and why the turn count is the least of it.
 *
 * Three limits are declared per surface. Only one was ever enforced, and it was
 * the weakest of the three:
 *
 *   - `maxTurns`         — enforced, and until now the only live guard
 *   - `maxBudgetUsd`     — DEAD. The route forwarded only a caller-supplied
 *                          value, and no caller supplies one, so every surface's
 *                          budget was inert while Settings → Capabilities
 *                          rendered it as "Budget: $1.00"
 *   - `queryTimeoutSecs` — enforced, aborts the stream
 *
 * ## Why a turn count is a bad governor
 *
 * It is a proxy for cost and time, and a poor one in both directions. Sixty
 * turns of `Read` is a few cents; sixty turns with an image on each is several
 * dollars. Nothing a user cares about is denominated in turns, so any specific
 * value is arbitrary — which is exactly how Chat ended up at 20 while Cowork sat
 * at 200 doing similar work, and how a deck build stopped halfway.
 *
 * Tying it to REMAINING CONTEXT, the obvious next idea, is worse. The SDK
 * compacts automatically (`PreCompact`/`PostCompact`, `SDKCompactBoundaryMessage`),
 * so context is not a monotonically depleting resource — a cap derived from it
 * would jump back up mid-run every time compaction fired. Context is already
 * handled, and not by this.
 *
 * ## What a turn cap is actually for
 *
 * A runaway backstop: a plan that never repeats and never finishes, which
 * neither the loop detector (it looks for REPEATS) nor a budget catches quickly.
 * That is a real failure mode and worth a ceiling. It is not worth a tuned
 * number, so there are two values here rather than five, chosen by whether a
 * human is watching:
 *
 *   - `interactive` — Chat, Cowork, Code. Someone is present and can interrupt,
 *     so the backstop only needs to sit above the longest legitimate workflow.
 *   - `unattended` — Assistant's standing orders, Browser's automation. Nobody
 *     is watching, so a runaway costs money until the timeout, and a tighter
 *     ceiling is worth the occasional truncation.
 *
 * The differentiation that MATTERS between surfaces is spend and wall-clock,
 * which are per-surface and mean something. This is deliberately coarse.
 *
 * ## Every ceiling must be loud
 *
 * This is the part the incident was actually about. The run stopped and the
 * result arrived looking like a completed answer, so the user re-prompted with
 * "go on then" to find out. Every comparable system makes this loud — the
 * OpenAI Agents SDK raises `MaxTurnsExceeded`, LangGraph raises
 * `GraphRecursionError`. Ours returned a result message with a `subtype` nobody
 * read. See `STOP_REASONS` in claude-provider.ts.
 */
export const TURN_BACKSTOP = {
  /** A person is watching and can interrupt. */
  interactive: 200,
  /** Nobody is watching; a runaway bills until the timeout. */
  unattended: 30,
} as const;
