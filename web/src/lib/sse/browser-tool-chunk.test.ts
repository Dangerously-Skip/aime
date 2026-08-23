import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleBrowserToolChunk } from './browser-tool-chunk';
import * as browserTools from '../browser-tools';
import type { WebviewRef } from '../browser-tools';

/*
 * THE ONE INVARIANT: every path POSTs a result.
 *
 * The server has paused a turn on a promise keyed by `toolUseId`. It has a
 * timeout, but reaching it costs the run a stalled minute with nothing on screen
 * to explain it — and the model then gets "no response from the browser" rather
 * than the actual error, so it cannot choose a different approach.
 *
 * So the failure cases are the point of this suite, not the happy path. Each
 * `it` below is a way the renderer can fail to answer, and each asserts it
 * answered anyway.
 */

const flush = () => new Promise((r) => setTimeout(r, 0));

let fetchMock: ReturnType<typeof vi.fn>;
let ctx: Parameters<typeof handleBrowserToolChunk>[1];

const EVENT = {
  type: 'browser_tool_use',
  toolUseId: 'tu_1',
  name: 'navigate',
  input: { url: 'https://example.com' },
};

const posted = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/api/chat/browser-tool-result')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ctx = {
    chatId: 'c1',
    webview: {} as HTMLElement & WebviewRef,
    addToolCall: vi.fn(),
    updateToolResult: vi.fn(),
    noWebviewMessage: 'No browser view is available.',
    surface: 'TestSurface',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('event routing', () => {
  it('ignores chunks that are not browser_tool_use', () => {
    expect(handleBrowserToolChunk({ type: 'text', text: 'hi' }, ctx)).toBe(false);
    expect(ctx.addToolCall).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('claims the event it handles, so call sites can chain', () => {
    vi.spyOn(browserTools, 'executeToolInWebview').mockResolvedValue({ success: true, message: 'ok' });
    expect(handleBrowserToolChunk(EVENT, ctx)).toBe(true);
  });
});

describe('the happy path', () => {
  it('shows the call, executes it, and reports the result both ways', async () => {
    const exec = vi
      .spyOn(browserTools, 'executeToolInWebview')
      .mockResolvedValue({ success: true, message: 'Navigated to example.com' });

    handleBrowserToolChunk(EVENT, ctx);

    // Shown immediately — before the tool runs, so a slow page load is visible.
    expect(ctx.addToolCall).toHaveBeenCalledWith('c1', expect.objectContaining({
      id: 'tu_1', name: 'navigate', status: 'running',
    }));

    await flush();
    expect(exec).toHaveBeenCalledWith(ctx.webview, 'navigate', { url: 'https://example.com' }, undefined);
    expect(ctx.updateToolResult).toHaveBeenCalledWith('c1', 'tu_1', 'Navigated to example.com', false);
    expect(posted()).toEqual([{ toolUseId: 'tu_1', output: 'Navigated to example.com', isError: false }]);
  });

  it('does not block the SSE reader on the tool', async () => {
    /*
     * The reader must keep draining while a page loads. If this awaited, every
     * subsequent event would queue behind a navigation.
     */
    let settle!: (v: { success: boolean; message: string }) => void;
    vi.spyOn(browserTools, 'executeToolInWebview').mockReturnValue(
      new Promise((r) => { settle = r; }),
    );
    expect(handleBrowserToolChunk(EVENT, ctx)).toBe(true);
    expect(posted()).toEqual([]);          // still running…
    settle({ success: true, message: 'done' });
    await flush();
    expect(posted()).toHaveLength(1);      // …and answered once it finished.
  });
});

describe('every failure path still answers the server', () => {
  it('answers when there is no webview, without calling the executor', async () => {
    const exec = vi.spyOn(browserTools, 'executeToolInWebview');
    handleBrowserToolChunk(EVENT, { ...ctx, webview: null });
    await flush();
    expect(exec).not.toHaveBeenCalled();
    expect(posted()).toEqual([
      { toolUseId: 'tu_1', output: 'No browser view is available.', isError: true },
    ]);
  });

  it('answers when the tool reports failure', async () => {
    vi.spyOn(browserTools, 'executeToolInWebview').mockResolvedValue({
      success: false, message: 'No element matched that selector',
    });
    handleBrowserToolChunk(EVENT, ctx);
    await flush();
    expect(ctx.updateToolResult).toHaveBeenCalledWith('c1', 'tu_1', 'No element matched that selector', true);
    expect(posted()).toEqual([
      { toolUseId: 'tu_1', output: 'No element matched that selector', isError: true },
    ]);
  });

  it('answers when the executor THROWS', async () => {
    // The one most likely to be missed, and the worst to miss: an exception in
    // the renderer would otherwise leave the turn waiting out its full timeout.
    vi.spyOn(browserTools, 'executeToolInWebview').mockRejectedValue(new Error('webview destroyed'));
    handleBrowserToolChunk(EVENT, ctx);
    await flush();
    const [body] = posted();
    expect(body.isError).toBe(true);
    expect(body.output).toContain('webview destroyed');
    expect(ctx.updateToolResult).toHaveBeenCalledWith('c1', 'tu_1', expect.stringContaining('webview destroyed'), true);
  });

  it('survives the POST itself failing, rather than throwing into the reader', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    vi.spyOn(browserTools, 'executeToolInWebview').mockResolvedValue({ success: true, message: 'ok' });
    expect(() => handleBrowserToolChunk(EVENT, ctx)).not.toThrow();
    await flush();
    await flush();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('TestSurface'),
      expect.any(Error),
    );
  });
});

describe('details that matter to the model', () => {
  it('passes the console buffer through, so console tools see logs', async () => {
    const consoleBuffer = new browserTools.ConsoleLogBuffer();
    const exec = vi.spyOn(browserTools, 'executeToolInWebview').mockResolvedValue({ success: true, message: 'ok' });
    handleBrowserToolChunk(EVENT, { ...ctx, consoleBuffer });
    await flush();
    expect(exec).toHaveBeenCalledWith(expect.anything(), 'navigate', expect.anything(), consoleBuffer);
  });

  it('tolerates an event with no input', async () => {
    const exec = vi.spyOn(browserTools, 'executeToolInWebview').mockResolvedValue({ success: true, message: 'ok' });
    handleBrowserToolChunk({ type: 'browser_tool_use', toolUseId: 't', name: 'get_page_state' }, ctx);
    await flush();
    expect(exec).toHaveBeenCalledWith(expect.anything(), 'get_page_state', {}, undefined);
  });
});

describe('tab tools, which are not webview operations', () => {
  /*
   * `executeToolInWebview` has no case for these — they act on the surface's
   * COLLECTION of webviews, not on one. The hand-rolled loop reached them
   * through callbacks of its own; routing the agent through the shared executor
   * dropped them, and a real run produced `Unknown tool: new_tab` twenty-two
   * times: DR-21's failure exactly, one layer down, with the agent unable to
   * discover the step was impossible.
   */
  const tabEvent = (name: string, input: Record<string, unknown> = {}) => ({
    type: 'browser_tool_use', toolUseId: 'tt_1', name, input,
  });

  it('never reaches the webview executor', async () => {
    const exec = vi.spyOn(browserTools, 'executeToolInWebview');
    const tabs = { open: vi.fn().mockResolvedValue(1), switch: vi.fn(), close: vi.fn(), list: () => [{ id: 't0' }, { id: 't1' }] };
    handleBrowserToolChunk(tabEvent('new_tab', { url: 'https://example.com' }), { ...ctx, tabs });
    await flush();
    expect(exec).not.toHaveBeenCalled();
    expect(tabs.open).toHaveBeenCalledWith('https://example.com');
  });

  it.each([
    ['switch_tab', 'switch'],
    ['close_tab', 'close'],
  ])('%s translates the model INDEX to a tab id', async (tool, key) => {
    /*
     * THIS TEST PINNED THE BUG. It passed `tab_id: 't7'` and asserted the
     * handler was called with 't7' — but no schema declares `tab_id`. The
     * schemas offer `tab_index`, a 0-based position in the open-tabs list,
     * because a position is what the model can see; the surface callbacks take
     * a UUID, because that is what still identifies a tab as the list changes.
     *
     * So the real path received '' and every switch and close failed, while
     * this test went green against a parameter nothing sends.
     */
    const tabs = {
      open: vi.fn(),
      switch: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(true),
      list: () => [{ id: 'uuid-a' }, { id: 'uuid-b' }, { id: 'uuid-c' }],
    };
    handleBrowserToolChunk(tabEvent(tool, { tab_index: 1 }), { ...ctx, tabs });
    await flush();
    expect((tabs as unknown as Record<string, ReturnType<typeof vi.fn>>)[key]).toHaveBeenCalledWith('uuid-b');
  });

  it('an out-of-range index says how many tabs there are', async () => {
    // Actionable beats silent: "index 7 does not exist, there are 2" is a fact
    // the model can use, and a quiet failure is what a retry loop feeds on.
    const tabs = {
      open: vi.fn(), switch: vi.fn(), close: vi.fn(),
      list: () => [{ id: 'a' }, { id: 'b' }],
    };
    handleBrowserToolChunk(tabEvent('switch_tab', { tab_index: 7 }), { ...ctx, tabs });
    await flush();
    expect(tabs.switch).not.toHaveBeenCalled();
    const [result] = posted();
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/2 open tabs/);
    expect(result.output).toMatch(/index 7 does not exist/);
  });

  it('a missing index is refused rather than sent as tab zero', async () => {
    // Defaulting to 0 would close the wrong tab, confidently.
    const tabs = {
      open: vi.fn(), switch: vi.fn(), close: vi.fn(),
      list: () => [{ id: 'a' }, { id: 'b' }],
    };
    handleBrowserToolChunk(tabEvent('close_tab', {}), { ...ctx, tabs });
    await flush();
    expect(tabs.close).not.toHaveBeenCalled();
    expect(posted()[0].isError).toBe(true);
  });

  it('reports success back to the waiting turn', async () => {
    const tabs = { open: vi.fn().mockResolvedValue(2), switch: vi.fn(), close: vi.fn(), list: () => [{ id: 't0' }, { id: 't1' }] };
    handleBrowserToolChunk(tabEvent('new_tab', { url: 'https://example.com' }), { ...ctx, tabs });
    await flush();
    expect(posted()).toEqual([{ toolUseId: 'tt_1', output: 'new_tab succeeded.', isError: false }]);
  });

  it('treats null and false as failure, not success', async () => {
    // `handleNewTab` resolves null when there is no conversation to own the tab.
    const tabs = { open: vi.fn().mockResolvedValue(null), switch: vi.fn(), close: vi.fn(), list: () => [{ id: 't0' }, { id: 't1' }] };
    handleBrowserToolChunk(tabEvent('new_tab', { url: 'https://example.com' }), { ...ctx, tabs });
    await flush();
    expect(posted()[0].isError).toBe(true);
  });

  it('answers when a handler throws', async () => {
    const tabs = { open: vi.fn().mockRejectedValue(new Error('boom')), switch: vi.fn(), close: vi.fn(), list: () => [{ id: 't0' }, { id: 't1' }] };
    handleBrowserToolChunk(tabEvent('new_tab', { url: 'x' }), { ...ctx, tabs });
    await flush();
    expect(posted()[0].isError).toBe(true);
    expect(posted()[0].output).toContain('boom');
  });

  it('on a surface with no tabs, says so and names the alternative', async () => {
    /*
     * The Code preview panel. "Unknown tool" is what let the agent retry
     * twenty-two times — it reads as a transient fault rather than a fact about
     * the world, so the message has to state the fact AND the way forward.
     */
    handleBrowserToolChunk(tabEvent('new_tab', { url: 'x' }), ctx); // no tabs
    await flush();
    const [body] = posted();
    expect(body.isError).toBe(true);
    expect(body.output).toContain('single page');
    expect(body.output).toContain('navigate');
    expect(body.output).toMatch(/do not try a tab tool again/i);
    expect(body.output).not.toContain('Unknown tool');
  });
});
