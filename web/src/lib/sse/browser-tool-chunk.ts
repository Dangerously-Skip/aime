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
  /**
   * Null when no webview can serve the call — reported to the model as an error.
   *
   * `WebviewRef`, not `HTMLElement & WebviewRef`: that is all
   * `executeToolInWebview` needs, and demanding the element type excluded Code
   * (whose preview ref is a plain `WebviewRef`) from using this module at all —
   * which is part of why it kept an inline copy.
   */
  webview: WebviewRef | null;
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
  /**
   * Tab management, when the surface has tabs.
   *
   * `executeToolInWebview` implements no case for `new_tab`, `switch_tab` or
   * `close_tab` — they are not webview operations, they are operations on the
   * surface's collection of webviews, and the old hand-rolled loop handled them
   * through callbacks of its own. Routing the agent through the shared executor
   * dropped them, and the result was DR-21's exact failure reproduced one layer
   * down: `Unknown tool: new_tab`, twenty-two times in one run, the agent
   * unable to discover that the step was impossible.
   */
  tabs?: {
    open: (url: string) => Promise<unknown>;
    switch: (tabId: string) => Promise<unknown>;
    close: (tabId: string) => Promise<unknown>;
    /** Open tabs in the order the model was shown them, for index → id. */
    list: () => Array<{ id: string }>;
  };
}

/** Tools that act on the surface's tabs rather than on one webview. */
const TAB_TOOLS = new Set(['new_tab', 'switch_tab', 'close_tab']);

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

  if (TAB_TOOLS.has(name)) {
    if (!ctx.tabs) {
      /*
       * A surface with one view. Say so ACTIONABLY and tell the model what to
       * do instead — "unknown tool" is what let it retry twenty-two times,
       * because it reads as a transient fault rather than a fact about the
       * world. Naming the alternative is what turns a wall into a signal.
       */
      const message =
        `${name} is not available here: this surface shows a single page, not tabs. ` +
        `Use navigate to go to a URL in this view, and do not try a tab tool again.`;
      ctx.updateToolResult(ctx.chatId, toolUseId, message, true);
      void postResult(toolUseId, message, true, ctx.surface);
      return true;
    }
    /*
     * INDEX IN, ID OUT — the translation this path was missing.
     *
     * The schemas offer `tab_index`: a 0-based position in the open-tabs list,
     * because that is what the model can see. The surface callbacks take a tab
     * UUID, because that is what identifies a tab as the list changes under it.
     * This read `input.tab_id`, which no schema declares, so every switch and
     * close received '' and failed — the quick-ask loop does this translation
     * and the shared path did not.
     *
     * An out-of-range index is reported as such rather than passed on as an
     * empty id: "tab 7 does not exist, there are 3" is actionable, and a silent
     * failure is what a retry loop is made of.
     */
    const tabs = ctx.tabs.list();
    const wantsIndex = name === 'switch_tab' || name === 'close_tab';
    let index = -1;
    if (wantsIndex) {
      const raw = input.tab_index ?? input.tabIndex ?? input.index;
      index = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
      if (!Number.isInteger(index) || index < 0 || index >= tabs.length) {
        const message =
          `${name} failed: there ${tabs.length === 1 ? 'is 1 open tab' : `are ${tabs.length} open tabs`}, ` +
          `so index ${Number.isInteger(index) ? index : String(input.tab_index ?? '?')} does not exist. ` +
          `Open tabs are numbered from 0${tabs.length ? ` to ${tabs.length - 1}` : ''}.`;
        ctx.updateToolResult(ctx.chatId, toolUseId, message, true);
        void postResult(toolUseId, message, true, ctx.surface);
        return true;
      }
    }

    const run =
      name === 'new_tab' ? ctx.tabs.open(String(input.url ?? ''))
      : name === 'switch_tab' ? ctx.tabs.switch(tabs[index].id)
      : ctx.tabs.close(tabs[index].id);

    void run
      .then((outcome) => {
        const failed = outcome === null || outcome === false;
        const message = failed
          ? `${name} failed. The tab could not be ${name === 'new_tab' ? 'opened' : 'changed'}.`
          : `${name} succeeded.`;
        ctx.updateToolResult(ctx.chatId, toolUseId, message, failed);
        return postResult(toolUseId, message, failed, ctx.surface);
      })
      .catch((err) => {
        const message = `${name} error: ${err instanceof Error ? err.message : String(err)}`;
        ctx.updateToolResult(ctx.chatId, toolUseId, message, true);
        return postResult(toolUseId, message, true, ctx.surface);
      });
    return true;
  }

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
