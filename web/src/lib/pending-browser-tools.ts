/**
 * In-memory registry for pending browser tool calls.
 *
 * When the Claude Agent SDK encounters a browser tool (navigate, click, etc.),
 * the canUseTool callback creates a promise here and blocks. The client
 * executes the tool in the webview and POSTs the result to
 * /api/chat/browser-tool-result, which calls resolveBrowserToolResult()
 * to unblock the waiting promise.
 *
 * Same pattern as pending-questions.ts.
 */

interface PendingEntry {
  resolve: (result: { output: string; isError: boolean }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

/**
 * Wait for a browser tool to execute in the client webview.
 * Returns a promise that resolves when resolveBrowserToolResult()
 * is called with the matching toolUseId.
 */
export function waitForBrowserToolResult(
  toolUseId: string,
): Promise<{ output: string; isError: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(toolUseId)) {
        pending.delete(toolUseId);
        reject(new Error('Browser tool execution timed out'));
      }
    }, 60_000);

    pending.set(toolUseId, { resolve, reject, timer });
  });
}

/**
 * Resolve a pending browser tool call with the execution result.
 * Returns true if the tool call was found and resolved.
 */
export function resolveBrowserToolResult(
  toolUseId: string,
  output: string,
  isError: boolean,
): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(toolUseId);
  entry.resolve({ output, isError });
  return true;
}
