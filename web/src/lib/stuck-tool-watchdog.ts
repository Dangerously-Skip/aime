import { streamRegistry } from './stream-registry';

/**
 * Abort a stream whose current tool call has stopped making progress.
 *
 * The Agent SDK can hang inside a single tool — a large PDF read is the usual
 * culprit — and the stream then sits there emitting nothing until the user gives
 * up. This watchdog gives one tool call a deadline and kills the stream if it is
 * still 'running' when the deadline passes.
 *
 * It lives here rather than inline in the Cowork surface because of the one thing
 * that is easy to get wrong and impossible to see: the abort must carry the
 * reason. `streamRegistry.abort(chatId)` defaults to 'user', so a genuine hang
 * was reported to the user as if they had pressed Stop — no error message, and
 * the Run recorded as a deliberate cancel rather than a timeout.
 */

/** How long one tool call may run without completing before the stream is killed. */
export const STUCK_TOOL_TIMEOUT_MS = 120_000;

export interface StuckToolWatch {
  chatId: string;
  toolId: string;
  /** For the log line only. */
  toolName: string;
  /** The tool's current status, re-read on every check. */
  getToolStatus: () => string | undefined;
  /** Store subscription; the returned function unsubscribes. */
  subscribe: (listener: () => void) => () => void;
  timeoutMs?: number;
}

/**
 * Start watching. Cancels itself as soon as the tool stops being 'running', so a
 * tool that completes normally never triggers anything.
 *
 * @returns a function that stops the watch early (e.g. the turn ended).
 */
export function watchStuckTool(watch: StuckToolWatch): () => void {
  const { chatId, toolId, toolName, getToolStatus, subscribe } = watch;
  const timeoutMs = watch.timeoutMs ?? STUCK_TOOL_TIMEOUT_MS;

  let stopped = false;
  // Hoisted, so both callbacks below can close over it before `unsubscribe` and
  // `timer` exist. Neither runs synchronously.
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
  }

  const timer = setTimeout(() => {
    stop();
    if (getToolStatus() !== 'running') return;
    console.warn(
      `[stuckTool] ${toolName} (${toolId}) made no progress for ${timeoutMs}ms — aborting stream`,
    );
    // 'timeout', NOT the default 'user': this is the agent hanging, not someone
    // pressing Stop. The reason is what turns it into an explanation for the user
    // and a 'timeout' Run instead of a silent cancel.
    streamRegistry.abort(chatId, 'timeout');
  }, timeoutMs);

  const unsubscribe = subscribe(() => {
    if (getToolStatus() === 'running') return;
    stop();
  });

  // The tool may already have finished between the caller adding it and us
  // subscribing — zustand only notifies on subsequent changes.
  if (getToolStatus() !== 'running') stop();

  return stop;
}
