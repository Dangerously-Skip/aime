/**
 * The contract for a turn that failed.
 *
 * The server classifies a failure once (from the SDK's typed assistant-message
 * `error`, `result.is_error`, an HTTP status, or a thrown error) and sends
 *
 *   { type: 'error', message: string, code: TurnErrorCode }
 *
 * The client renders `describeTurnError(code, message)` as a distinct error
 * banner — never as text appended to the assistant's reply, which then went
 * back to the model as something it had said, and showed the user raw CLI
 * advice like "Please run /login" for a command this app does not have.
 */
import type { SettingsSectionId } from '@/stores/app-store';
// Type-only: this module is shared with the client, which must not load the SDK.
import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';

export type TurnErrorCode =
  | 'no_model'          // nothing configured that can serve this turn
  | 'auth'              // key missing, invalid or revoked
  | 'billing'           // out of credit / billing problem at the provider
  | 'rate_limit'        // 429
  | 'overloaded'        // 529 / 503 from the provider
  | 'context_length'    // prompt too long for the model
  | 'max_output_tokens' // reply hit the output cap
  | 'network'           // could not reach the provider / local server
  | 'timeout'           // the turn went silent and was stopped
  | 'unknown';

export const TURN_ERROR_CODES: readonly TurnErrorCode[] = [
  'no_model', 'auth', 'billing', 'rate_limit', 'overloaded', 'context_length',
  'max_output_tokens', 'network', 'timeout', 'unknown',
];

export function isTurnErrorCode(v: unknown): v is TurnErrorCode {
  return typeof v === 'string' && (TURN_ERROR_CODES as readonly string[]).includes(v);
}

/**
 * Best-effort classification of an untyped error string. Prefer the SDK's typed
 * error kinds where they exist (`mapSdkErrorKind`); this is the fallback for
 * thrown errors and HTTP bodies.
 */
export function classifyTurnError(message: string, status?: number): TurnErrorCode {
  const m = message.toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 529 || status === 503) return 'overloaded';
  if (status === 402) return 'billing';
  if (/not logged in|\/login|invalid.{0,12}api.?key|x-api-key|authentication|unauthori[sz]ed|no api key|api key (is )?(missing|required)/.test(m)) return 'auth';
  if (/credit balance|billing|payment required|insufficient.{0,10}(credit|funds|quota)/.test(m)) return 'billing';
  if (/rate.?limit|too many requests/.test(m)) return 'rate_limit';
  if (/overloaded|capacity|service unavailable/.test(m)) return 'overloaded';
  if (/prompt is too long|context (length|window)|too many tokens|maximum context/.test(m)) return 'context_length';
  if (/max_output_tokens|max_tokens|output token/.test(m)) return 'max_output_tokens';
  if (/no model|model is not configured|no route/.test(m)) return 'no_model';
  if (/econnrefused|enotfound|fetch failed|network|socket hang up|econnreset/.test(m)) return 'network';
  if (/timed out|timeout|went silent|was stopped/.test(m)) return 'timeout';
  return 'unknown';
}

/**
 * The SDK's typed assistant-message `error` kinds, each decided once.
 *
 * Keyed by the SDK's own union so that a kind added by an upgrade fails the
 * typecheck here instead of quietly falling through to text-guessing — 0.3
 * added six. `null` means "too broad or no good fit; classify the text".
 */
const SDK_ERROR_KINDS: Record<SDKAssistantMessageError, TurnErrorCode | null> = {
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'auth',
  cloud_credential_error: 'auth', // Bedrock / Vertex credentials
  billing_error: 'billing',
  account_on_hold: 'billing',     // "your provider account needs attention"
  rate_limit: 'rate_limit',
  overloaded: 'overloaded',
  server_error: 'overloaded',
  max_output_tokens: 'max_output_tokens',
  // A wrong model id, not a missing setup — `no_model` would tell the user to
  // connect one. The CLI's text names the model, which is the useful part.
  model_not_found: null,
  verification_required: null,
  invalid_request: null,
  unknown: null,
};

export function mapSdkErrorKind(kind: string | undefined | null): TurnErrorCode | null {
  if (!kind || !Object.prototype.hasOwnProperty.call(SDK_ERROR_KINDS, kind)) return null;
  return SDK_ERROR_KINDS[kind as SDKAssistantMessageError];
}

export interface TurnErrorDescription {
  title: string;
  detail: string;
  /** Offer "Try again". */
  retryable: boolean;
  /** Where the user fixes it, when that is Settings. */
  action?: { label: string; settingsSection: SettingsSectionId };
}

export function describeTurnError(code: TurnErrorCode, rawMessage?: string): TurnErrorDescription {
  switch (code) {
    case 'no_model':
      return {
        title: 'No model is set up yet',
        detail: 'Add an API key or a provider so there is a model to answer.',
        retryable: false,
        action: { label: 'Connect a model', settingsSection: 'connectors' },
      };
    case 'auth':
      return {
        title: 'The model provider rejected your credentials',
        detail: 'Your API key is missing, invalid, or has been revoked.',
        retryable: false,
        action: { label: 'Check API access', settingsSection: 'connectors' },
      };
    case 'billing':
      return {
        title: 'Your provider account needs attention',
        detail: 'The provider reported a billing or credit problem.',
        retryable: false,
      };
    case 'rate_limit':
      return { title: 'Rate limited', detail: 'The provider is limiting requests. Wait a moment and try again.', retryable: true };
    case 'overloaded':
      return { title: 'The provider is overloaded', detail: 'This is usually temporary. Try again in a moment.', retryable: true };
    case 'context_length':
      return { title: 'This conversation is too long for the model', detail: 'Start a new conversation, or remove large attachments.', retryable: false };
    case 'max_output_tokens':
      return { title: 'The reply hit its length limit', detail: 'Ask the model to continue where it stopped.', retryable: true };
    case 'network':
      return { title: 'Could not reach the model', detail: 'Check your connection and try again.', retryable: true };
    case 'timeout':
      return { title: 'The turn was stopped', detail: rawMessage || 'The model stopped responding.', retryable: true };
    default:
      return { title: 'Something went wrong', detail: rawMessage || 'The turn failed.', retryable: true };
  }
}
