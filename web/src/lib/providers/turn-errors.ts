import {
  classifyTurnError,
  isTurnErrorCode,
  mapSdkErrorKind,
  type TurnErrorCode,
} from '../sse/turn-error';

/**
 * Server-side halves of the turn-error contract (see lib/sse/turn-error.ts):
 * turning what the Agent SDK hands back — a typed assistant `error`, an
 * `is_error` result, an `api_retry` notice, or a thrown Error — into a
 * `TurnErrorCode` and a message fit to show.
 */

/**
 * The prefix the SDK puts on the Error it throws after an `is_error` result.
 * The result text itself already said what went wrong.
 */
const SDK_RESULT_PREFIX = /^Claude Code returned an error result:\s*/i;

/**
 * Remove CLI-only advice from an SDK error string.
 *
 * "Not logged in · Please run /login" names a command this app does not have;
 * the typed code is what tells the client where the user fixes it.
 */
export function cleanSdkErrorText(text: string): string {
  return text
    .replace(SDK_RESULT_PREFIX, '')
    .replace(/\s*[·•-]?\s*Please run \/login\.?/gi, '')
    .trim();
}

/**
 * Is this assistant message the CLI reporting a failure rather than the model
 * speaking?
 *
 * The SDK marks it with `error` (SDKAssistantMessageError). Older CLIs sent the
 * same synthetic message without the field, so a `<synthetic>` message whose
 * text is the login prompt or an API error counts too.
 */
export function sdkErrorKindOf(message: {
  error?: unknown;
  message?: { model?: unknown };
}, text: string): string | null {
  if (typeof message.error === 'string' && message.error) return message.error;
  if (message.message?.model === '<synthetic>' && /please run \/login|^api error/i.test(text.trim())) {
    return 'unknown';
  }
  return null;
}

/** Code for an assistant-message error kind, falling back to its text. */
export function codeForSdkError(kind: string | null | undefined, text: string): TurnErrorCode {
  return mapSdkErrorKind(kind) ?? classifyTurnError(text);
}

/** Code for an SDK `api_retry` notice. A null status is a connection failure. */
export function codeForRetry(kind: string | null | undefined, status: number | null | undefined): TurnErrorCode {
  const typed = mapSdkErrorKind(kind);
  if (typed) return typed;
  if (status === null || status === undefined) return 'network';
  const byStatus = classifyTurnError('', status);
  return byStatus === 'unknown' && status >= 500 ? 'overloaded' : byStatus;
}

/** Where a thrown error's HTTP status lives, across the SDK and fetch clients. */
function statusOf(err: Record<string, unknown>): number | undefined {
  for (const v of [err.status, err.statusCode, (err.response as Record<string, unknown> | undefined)?.status]) {
    if (typeof v === 'number') return v;
  }
  return undefined;
}

/**
 * Classify something a provider threw.
 *
 * The provider tags the errors it rethrows with `turnErrorCode` (see
 * ClaudeProvider.query) so a code decided with more context is not re-guessed
 * here from the message alone.
 */
export function classifyThrownTurnError(error: unknown): { code: TurnErrorCode; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const message = cleanSdkErrorText(raw) || raw;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (isTurnErrorCode(e.turnErrorCode)) return { code: e.turnErrorCode, message };
    const byMessage = classifyTurnError(message, statusOf(e));
    if (byMessage !== 'unknown') return { code: byMessage, message };
    // Node's network failures carry the useful part in `code`, not the message.
    if (typeof e.code === 'string') {
      const byCode = classifyTurnError(e.code);
      if (byCode !== 'unknown') return { code: byCode, message };
    }
    return { code: 'unknown', message };
  }
  return { code: classifyTurnError(message), message };
}
