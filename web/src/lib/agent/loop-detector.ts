/**
 * Consecutive-identical-call detection, shared by the agent surfaces.
 *
 * Extracted from `claude-provider.ts`, where it had been guarding Chat, Cowork
 * and Code for some time — and where the browser agent could not reach it. The
 * browser turn runs its own loop against the raw Messages API, so it had no
 * detector at all, and it showed:
 *
 *   "let me go back to the camera search page and click the actual links…"
 *   "Let me go back to the camera search results page and open…"
 *   "Let me go back to the camera search results and click the top ROI items…"
 *   "I'll go back to the working camera page:"
 *
 * Four restatements, no progress, no bound. The literature calls this FM1,
 * "context-bound search loops" (arXiv 2606.20724): repeating near-identical
 * intents while retrieving nothing new.
 *
 * WHAT IT DOES AND DOES NOT CATCH. This is a cheap exact-match detector on
 * (tool name, serialised input). It catches a stuck agent hammering the same
 * call, which is the common case and the one that burns a budget fastest. It
 * does NOT catch semantic looping — four differently-worded attempts at the
 * same thing — which is what change observation and the goal harness are for.
 * Keeping it exact keeps it free of false positives: a legitimate retry with
 * different arguments is not a loop, and a detector that thinks so is worse
 * than none.
 */

export const LOOP_WARN_THRESHOLD = 3;
export const LOOP_DENY_THRESHOLD = 5;

export interface LoopCall {
  name: string;
  inputHash: string;
}

/** Bounded sliding window; ten is enough to see a loop and cheap to carry. */
export const LOOP_WINDOW_SIZE = 10;

export type LoopVerdict =
  | { action: 'allow' }
  | { action: 'warn'; count: number }
  | { action: 'deny'; count: number; message: string };

/**
 * Record a call and judge it.
 *
 * Mutates `window` — it is a per-run scratchpad, and threading a new array
 * through every call site buys nothing here.
 */
export function recordAndDetect(
  window: LoopCall[],
  name: string,
  input: unknown,
): LoopVerdict {
  const inputHash = JSON.stringify(input ?? null);
  window.push({ name, inputHash });
  if (window.length > LOOP_WINDOW_SIZE) window.shift();

  // Consecutive from the end: an identical call five apart is not a loop.
  let count = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].name === name && window[i].inputHash === inputHash) count++;
    else break;
  }

  if (count >= LOOP_DENY_THRESHOLD) {
    return {
      action: 'deny',
      count,
      /*
       * The message is the useful part. "Denied" alone leaves the model to
       * guess, and a model that guesses after being blocked tends to try the
       * same thing once more. Naming the loop and asking for a different
       * approach is what turns a wall into a signal.
       */
      message:
        `Blocked: you have called ${name} ${count} times in a row with identical inputs and nothing changed. ` +
        `That is a loop. Do not repeat it — either try a materially different approach, or stop and tell the ` +
        `user what is blocking you and what you would need to proceed.`,
    };
  }
  if (count >= LOOP_WARN_THRESHOLD) return { action: 'warn', count };
  return { action: 'allow' };
}
