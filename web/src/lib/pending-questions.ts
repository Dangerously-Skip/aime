/**
 * In-memory registry for pending AskUserQuestion tool calls.
 *
 * When the Claude Agent SDK calls AskUserQuestion, the canUseTool callback
 * creates a promise here and blocks. The client collects the user's answers
 * and POSTs them to /api/chat/answer, which calls resolveAnswer() to unblock
 * the waiting promise.
 */

interface PendingEntry {
  resolve: (answers: Record<string, string>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

/**
 * Wait for the user to answer a question. Returns a promise that resolves
 * when resolveAnswer() is called with the matching toolUseId.
 */
export function waitForAnswer(toolUseId: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(toolUseId)) {
        pending.delete(toolUseId);
        reject(new Error('Question timed out'));
      }
    }, 300_000);

    pending.set(toolUseId, { resolve, reject, timer });
  });
}

/**
 * Resolve a pending question with the user's answers.
 * Returns true if the question was found and resolved.
 */
export function resolveAnswer(toolUseId: string, answers: Record<string, string>): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(toolUseId);
  entry.resolve(answers);
  return true;
}
