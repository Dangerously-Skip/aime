/**
 * Module-level AbortController registry keyed by chatId, plus the abort-cause
 * plumbing that goes with it.
 *
 * The registry lives outside any React component lifecycle so active SSE
 * streams survive surface switches. Its job is holding controllers — nothing
 * more. WHY a stream was aborted travels as an explicit cause on
 * `AbortController.abort(reason)`; it is never inferred from whether an entry
 * is still present. That side channel is what let a user's Stop be reported as
 * an inactivity timeout: `abort()` deletes the entry, so "entry missing" meant
 * the opposite of what the code assumed.
 */

export type StreamAbortReason =
  /** Deliberate cancel: Stop button, conversation switch, stuck-tool cancel. */
  | 'user'
  /** No data for the inactivity window — the connection or agent is stuck. */
  | 'timeout'
  /** A newer stream took this chat over; it owns the chat's UI state now. */
  | 'superseded';

/** The cause object handed to `AbortController.abort()` so the reason survives. */
export class StreamAbortCause extends Error {
  readonly reason: StreamAbortReason;
  /**
   * What specifically timed out, in the user's words — e.g. "the WebFetch tool
   * ran for 120s without returning". A bare reason is not enough to write a
   * truthful message: 'timeout' covers both a dead connection and one slow tool
   * call, and telling a user their agent "may be stuck" when a WebFetch was
   * half a second from returning sent them to retry work already on disk.
   */
  readonly detail?: string;
  constructor(reason: StreamAbortReason, detail?: string) {
    super(`Stream aborted (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'StreamAbortCause';
    this.reason = reason;
    this.detail = detail;
  }
}

/** The `detail` off an abort cause, when there is one. */
export function abortDetailOf(signal: AbortSignal | null | undefined): string | undefined {
  const cause: unknown = signal?.reason;
  return cause instanceof StreamAbortCause ? cause.detail : undefined;
}

/**
 * The reason a stream was aborted, read off its signal — `null` when the signal
 * is not aborted at all. An abort we did not tag (someone calling
 * `controller.abort()` directly) counts as 'user': treating an unexplained
 * cancel as deliberate is the safe default, because it finalises the turn
 * without inventing an error the user never hit.
 */
export function abortReasonOf(signal: AbortSignal | null | undefined): StreamAbortReason | null {
  if (!signal?.aborted) return null;
  const cause: unknown = signal.reason;
  return cause instanceof StreamAbortCause ? cause.reason : 'user';
}

/** An in-flight stream ended because it was aborted, not because it finished. */
export interface StreamAbortEvent {
  chatId: string;
  /**
   * 'superseded' never reaches listeners: the replacement stream owns the
   * chat's UI state, so finalising it would clear a live turn's spinner.
   */
  reason: Exclude<StreamAbortReason, 'superseded'>;
}

type StreamAbortListener = (event: StreamAbortEvent) => void;
const abortListeners = new Set<StreamAbortListener>();

/**
 * Subscribe to aborted streams. The message stores use this to clear the
 * per-message streaming flags: an aborted fetch never reaches a surface's
 * onDone/onError, so nothing else in the app would.
 *
 * @returns an unsubscribe function.
 */
export function onStreamAborted(listener: StreamAbortListener): () => void {
  abortListeners.add(listener);
  return () => {
    abortListeners.delete(listener);
  };
}

/**
 * Announce that a stream ended by abort. Called once per aborted stream, by the
 * stream's owner (`useSSEStream`), which is the only place that knows both the
 * chatId the stream was started for and the cause it ended with.
 */
export function notifyStreamAborted(event: StreamAbortEvent): void {
  for (const listener of [...abortListeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error('[streamRegistry] abort listener failed', error);
    }
  }
}

const controllers = new Map<string, AbortController>();

export const streamRegistry = {
  set: (chatId: string, c: AbortController) => controllers.set(chatId, c),

  /**
   * Abort the stream for chatId, carrying WHY on the signal. A no-op when no
   * stream is running for that chat.
   */
  abort: (chatId: string, reason: StreamAbortReason = 'user', detail?: string) => {
    const controller = controllers.get(chatId);
    controllers.delete(chatId);
    controller?.abort(new StreamAbortCause(reason, detail));
  },

  /**
   * Give up ownership of a chat at stream end.
   *
   * @returns false when a newer stream has taken the chat over — the caller was
   * superseded and must not touch shared state (its own entry is already gone).
   */
  release: (chatId: string, controller: AbortController): boolean => {
    const current = controllers.get(chatId);
    if (current && current !== controller) return false;
    controllers.delete(chatId);
    return true;
  },

  has: (chatId: string) => controllers.has(chatId),
};
