import { executeToolInWebview, type WebviewRef, type ConsoleLogBuffer } from '../browser-tools';

/**
 * The client half of the browser-tool relay.
 *
 * The server pauses a turn on a promise, emits `browser_tool_use`, and waits for
 * `POST /api/chat/browser-tool-result` to unblock it. Only the renderer can do
 * the middle part, because only the renderer has the live `<webview>`.
 *
 * WHY THIS IS SHARED CODE AND NOT COPIED. Code had this inline. Routing the
 * Browser surface through the same chat path needs the identical forty lines,
 * and this repo's most repeated injury is two implementations of one idea
 * drifting apart — four places once picked a model, two systems described
 * panels, a loop detector was rewritten rather than shared. Copying it here
 * would be that mistake made deliberately, in the week it was last paid for.
 *
 * THE PART THAT MUST NOT BE FORGOTTEN: every path POSTs a result, including
 * every failure path. The server-side promise has a timeout, but reaching it
 * costs the run a stalled minute with nothing on screen to explain it. An error
 * reported promptly is a turn the model can recover from; silence is not.
 */

export interface BrowserToolChunkContext {
  chatId: string;
  /** Null when no webview can serve the call — reported to the model as an error. */
  webview: (HTMLElement & WebviewRef) | null;
  consoleBuffer?: ConsoleLogBuffer;
  addToolCall: (
    chatId: string,
    call: {
      id: string;
      name: string;
      input: Record<string, unknown>;
      status: 'running';
      startTime: number;
    },
  ) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  /**
   * What to say when there is no webview. Differs by surface: Code means "open
   * the preview panel", Browser means "navigate to a page". A generic message
   * would leave the model guessing at which of those it can act on.
   */
  noWebviewMessage: string;
  /** Named in the console line, so a failure says which surface it came from. */
  surface: string;
}

/** Report the outcome back to the waiting server-side promise. */
function postResult(toolUseId: string, output: string, isError: boolean, surface: string): Promise<unknown> {
  return fetch('/api/chat/browser-tool-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolUseId, output, isError }),
  }).catch((err) => {
    // Nothing left to do but say so: the turn will now wait out its timeout.
    console.error(`[${surface}] Failed to POST browser tool result:`, err);
  });
}

/**
 * Handle a `browser_tool_use` event.
 *
 * Returns true if it handled the event, false if it was some other chunk — the
 * same shape as `handleCoreChunk`, so call sites read as a chain.
 *
 * Deliberately NOT awaited by the caller. The SSE reader must keep draining the
 * stream while a tool runs; blocking it would stall every subsequent event
 * behind a page load.
 */
export function handleBrowserToolChunk(
  event: Record<string, unknown>,
  ctx: BrowserToolChunkContext,
): boolean {
  if (event.type !== 'browser_tool_use') return false;

  const toolUseId = event.toolUseId as string;
  const name = event.name as string;
  const input = (event.input as Record<string, unknown>) || {};

  ctx.addToolCall(ctx.chatId, { id: toolUseId, name, input, status: 'running', startTime: Date.now() });

  const wv = ctx.webview;
  if (!wv) {
    ctx.updateToolResult(ctx.chatId, toolUseId, ctx.noWebviewMessage, true);
    void postResult(toolUseId, ctx.noWebviewMessage, true, ctx.surface);
    return true;
  }

  void executeToolInWebview(wv, name, input, ctx.consoleBuffer)
    .then((result) => {
      ctx.updateToolResult(ctx.chatId, toolUseId, result.message, !result.success);
      return postResult(toolUseId, result.message, !result.success, ctx.surface);
    })
    .catch((err) => {
      const message = `Browser tool error: ${err instanceof Error ? err.message : String(err)}`;
      ctx.updateToolResult(ctx.chatId, toolUseId, message, true);
      return postResult(toolUseId, message, true, ctx.surface);
    });

  return true;
}
