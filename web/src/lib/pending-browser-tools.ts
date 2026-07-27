/**
 * Cross-request bridge for pending browser tool calls.
 *
 * When the Claude Agent SDK reaches a browser tool (navigate, click, …), the
 * canUseTool callback parks a promise here and blocks. The client executes the
 * tool in the webview and POSTs the result to /api/chat/browser-tool-result,
 * which calls resolveBrowserToolResult() to unblock it.
 *
 * Mechanics in rendezvous.ts. What is specific here: the budget is machine-paced
 * (one DOM operation, not a human decision), and silence REJECTS — a browser step
 * that never ran is a genuine tool failure, not a result.
 */
import { createRendezvous, type WaitOptions } from './rendezvous';

export interface BrowserToolResult {
  output: string;
  isError: boolean;
}

const browserTools = createRendezvous<BrowserToolResult>({
  label: 'pending-browser-tools',
  timeoutMs: 60_000,
  onTimeout: { reject: 'Browser tool execution timed out' },
  onAbort: { reject: 'Browser tool cancelled — the turn was stopped' },
});

/** One DOM operation in the webview: machine-paced, so a minute is generous. */
export const BROWSER_TOOL_TIMEOUT_MS = browserTools.timeoutMs;

/**
 * Wait for a browser tool to execute in the client webview. Rejects on timeout
 * or when the query is aborted.
 */
export function waitForBrowserToolResult(
  toolUseId: string,
  options?: WaitOptions,
): Promise<BrowserToolResult> {
  return browserTools.wait(toolUseId, options);
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
  return browserTools.settle(toolUseId, { output, isError });
}

/** Test/observability helper. */
export function pendingBrowserToolCount(): number {
  return browserTools.size();
}
