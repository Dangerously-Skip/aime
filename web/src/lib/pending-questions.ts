/**
 * Cross-request bridge for pending AskUserQuestion tool calls.
 *
 * When the Claude Agent SDK calls AskUserQuestion, the canUseTool callback parks
 * a promise here and blocks. The client collects the user's answers and POSTs
 * them to /api/chat/answer, which calls resolveAnswer() to unblock it.
 *
 * The mechanics live in rendezvous.ts, shared with the browser-tool, connector
 * and document bridges. All this file decides is the budget (four minutes — a
 * human has to read and click, but the park must stay under every surface's
 * silence timer; see the timeoutMs comment below) and that silence REJECTS: an
 * unanswered question is not an answer, and the caller distinguishes "the
 * prompt expired" from "they said no".
 *
 * The `toolUseId` these functions take is the nonce-bearing handle the provider
 * issued, not the SDK's tool use id: knowing it is the whole of what authorises an
 * answer on an unauthenticated route. See rendezvous.issueHandle.
 */
import { createRendezvous, type WaitOptions } from './rendezvous';

const questions = createRendezvous<Record<string, string>>({
  label: 'pending-questions',
  // Four minutes, NOT five. While parked the SDK loop is paused and nothing
  // streams, so the route's silence timer keeps running — and the browser
  // surface's budget is exactly 300s. A user taking ~5 minutes to answer had
  // their turn cancelled as they clicked. 240s leaves a full silence period of
  // headroom on every surface (the others are 600s), without teaching the
  // route about parks.
  timeoutMs: 240_000,
  onTimeout: { reject: 'Question timed out' },
  // A cancelled turn is not a decline. The caller reports the difference.
  onAbort: { reject: 'Question cancelled — the turn was stopped' },
});

/** Four minutes: the user has to read the card and click. */
export const QUESTION_TIMEOUT_MS = questions.timeoutMs;

/**
 * Wait for the user to answer a question. Resolves when resolveAnswer() is
 * called with the matching toolUseId; rejects on timeout or on abort.
 */
export function waitForAnswer(
  toolUseId: string,
  options?: WaitOptions,
): Promise<Record<string, string>> {
  return questions.wait(toolUseId, options);
}

/**
 * Resolve a pending question with the user's answers.
 * Returns true if the question was found and resolved.
 */
export function resolveAnswer(toolUseId: string, answers: Record<string, string>): boolean {
  return questions.settle(toolUseId, answers);
}

/** Test/observability helper — how many questions are awaiting an answer. */
export function pendingQuestionCount(): number {
  return questions.size();
}
