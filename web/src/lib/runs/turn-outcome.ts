import { classifyTurnError, describeTurnError, isTurnErrorCode, type TurnErrorCode } from '@/lib/sse/turn-error';

/**
 * Did this turn fail? — told to whoever records it.
 *
 * THE BUG. A failed turn was recorded as "Succeeded". The server reports a
 * failure as an SSE `error` event and then closes the stream normally, so the
 * stream hook reaches `onDone` — and every surface's `onDone` calls
 * `runRecorder.succeed()`. The error event went to `onChunk`, which the recorder
 * never sees. Seen live: a no-API-key chat showed "Succeeded" in Recent Activity.
 *
 * WHY A CHANNEL AND NOT A SURFACE CHANGE. Four surfaces call `succeed()` from
 * `onDone`; fixing it there is four edits that the fifth surface will not know
 * about. The stream hook is the one place every turn passes through, so it
 * reports each event here, and the turn wiring — which already owns "does this
 * chatId belong to me?" for aborts — listens. `succeed()` then records the
 * failure it was told about instead of a success.
 */

export interface TurnFailure {
  chatId: string;
  code: TurnErrorCode;
  /** Already worded for the run log. */
  message: string;
}

/** The failure an SSE event reports, or null for every other event. */
export function turnFailureFromEvent(event: { type?: unknown; [key: string]: unknown }): Omit<TurnFailure, 'chatId'> | null {
  const raw = typeof event.message === 'string' ? event.message : '';
  if (event.type === 'error') {
    const code = isTurnErrorCode(event.code) ? event.code : classifyTurnError(raw);
    return { code, message: raw || describeTurnError(code).title };
  }
  // A `done` that says the turn failed, for a provider that reports it that way.
  if (event.type === 'done' && event.error) {
    const code = isTurnErrorCode(event.code) ? event.code : classifyTurnError(raw);
    return { code, message: raw || describeTurnError(code).title };
  }
  return null;
}

type Listener = (failure: TurnFailure) => void;
const listeners = new Set<Listener>();

/** Subscribe to failed turns. Returns the unsubscribe. */
export function onTurnFailed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the stream hook for every event of a turn. Cheap for non-failures. */
export function reportTurnEvent(chatId: string, event: { type?: unknown; [key: string]: unknown }): void {
  const failure = turnFailureFromEvent(event);
  if (!failure) return;
  for (const listener of [...listeners]) {
    try {
      listener({ chatId, ...failure });
    } catch (error) {
      console.error('[turn-outcome] listener failed', error);
    }
  }
}
