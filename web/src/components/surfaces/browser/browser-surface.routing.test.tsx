// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { BrowserSurface } from './browser-surface';
import { useBrowserStore } from '@/stores/browser-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * WHICH LOOP ANSWERED, asserted through the real surface and its real composer.
 *
 * This surface has two paths (DR-22 D-1) and they hit DIFFERENT ENDPOINTS, which
 * is what makes this testable without mocking anything internal:
 *
 *   - quick ask  → `/api/chat/browser-turn`, the local loop, browser tools only
 *   - full agent → `/api/chat/browser`,      the main chat path, everything else
 *
 * `request-shape.test.ts` already proves the classifier sorts requests correctly.
 * What it CANNOT prove is that the surface consults it, or that each answer
 * reaches the loop it names — and that wiring is exactly where this session has
 * repeatedly shipped a capability that was present, correct, and unreachable.
 * A source-scan for the word `classifyBrowserRequest` would pass on a call whose
 * result is discarded. Only driving the composer says which fetch happened.
 */

const CHAT = 'browser-conv';

const fetchMock = vi.fn();

/** Headers arrive, body never does — enough to observe the request. */
function stalledStream(init: RequestInit): Promise<Response> {
  const signal = init?.signal as AbortSignal | undefined;
  const reader = {
    read: () =>
      new Promise<never>((_res, rej) => {
        if (signal?.aborted) rej(signal.reason);
        signal?.addEventListener('abort', () => rej(signal.reason));
      }),
    cancel: () => Promise.resolve(),
  };
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: { getReader: () => reader },
  } as unknown as Response);
}

/** Which chat endpoints were called, in order. */
const chatCalls = (): string[] =>
  fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.includes('/api/chat/'));

/** Drive the URL bar, so a real <webview> node mounts and the ref is populated. */
async function navigate(url: string) {
  const bar = screen.getByPlaceholderText('Enter URL or search...');
  await act(async () => {
    fireEvent.change(bar, { target: { value: url } });
    fireEvent.keyDown(bar, { key: 'Enter', code: 'Enter' });
  });
}

async function submit(text: string) {
  const box = screen.getByPlaceholderText(/ask|message|what/i) as HTMLTextAreaElement;
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = () => {};

  fetchMock.mockImplementation((url: string, init: RequestInit) =>
    String(url).includes('/api/chat/')
      ? stalledStream(init)
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  /*
   * `tabSessions` and `activeTabIds` MUST be reset too. Leaving them made a test
   * that never navigated still find an open page — the surface restored the
   * previous test's tab — so it asserted the no-webview guarantee while a
   * webview was present, and passed for the wrong reason.
   */
  useBrowserStore.setState({
    messages: {}, currentChatId: CHAT, isStreaming: false,
    tabSessions: {}, activeTabIds: {}, pendingContext: [],
  } as never);
  useConversationStore.setState({ conversations: [], activeId: null } as never);
  useConversationStore.getState().addConversation({
    id: CHAT, title: 'Browser', surface: 'browser', lastMessage: '',
    createdAt: Date.now(), updatedAt: Date.now(),
  });
  useSettingsStore.setState({ anthropicApiKey: 'sk-test' } as never);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('a goal reaches the full agent', () => {
  it('routes the camera task to /api/chat/browser', async () => {
    // The reported failure. On the old surface this went to the local loop,
    // which had no file to write to, no table, and no memory — so it could not
    // have succeeded however good the loop got.
    render(<BrowserSurface />);
    await submit('inspect the camera listings across multiple pages, find the best ROI, give me the links');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    expect(chatCalls()[0]).toContain('/api/chat/browser');
    expect(chatCalls()[0]).not.toContain('browser-turn');
  });

  it('offers browser tools once a page is open', async () => {
    /*
     * `browserToolsAvailable` is what tells the server to register `navigate`,
     * `click` and the rest on the MCP server for this turn. Without it the run
     * is the full agent MINUS the entire point of this surface — which would
     * pass every other test here, because they only assert which endpoint was
     * called.
     */
    render(<BrowserSurface />);
    await navigate('https://example.com');
    await submit('find me the cheapest flight to sydney');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/chat/browser'))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.browserToolsAvailable).toBe(true);
  });

  it('does NOT offer them when there is no page open', async () => {
    /*
     * The complement, and the one that matters more. Offering a tool nothing can
     * execute is DR-21's loop one layer down: the agent cannot discover that the
     * step is impossible, so it restates the same intent until the turn dies.
     *
     * Sent as absent rather than `false` — `use-sse-stream` spreads the key only
     * when true and the route defaults it to false. Asserted as "not true" so
     * this test tracks the guarantee rather than that encoding.
     */
    render(<BrowserSurface />);
    await submit('find me the cheapest flight to sydney');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/chat/browser'))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.browserToolsAvailable ?? false).toBe(false);
  });

  it('carries the user text through to the request', async () => {
    render(<BrowserSurface />);
    await submit('compare the pricing on these three plans');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/chat/browser'))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.message).toContain('compare the pricing');
  });
});

describe('a page question stays on the local loop', () => {
  it('sends "what is on this page?" to browser-turn, not to the agent', async () => {
    /*
     * The other half of the split, and the one a one-sided change would break
     * silently: routing EVERYTHING through the agent would pass every test above
     * while making the common case slower and more expensive for no gain.
     */
    render(<BrowserSurface />);
    await navigate('https://example.com');
    await submit('what is on this page?');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    expect(chatCalls()[0]).toContain('/api/chat/browser-turn');
  });

  it('summarise-this also stays local', async () => {
    render(<BrowserSurface />);
    await navigate('https://example.com');
    await submit('summarise this');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    expect(chatCalls()[0]).toContain('/api/chat/browser-turn');
  });

  it('still refuses a page question with no page open', async () => {
    // Only the quick-ask branch has this guard, so the message also identifies
    // which branch ran.
    render(<BrowserSurface />);
    await submit('what is on this page?');

    await act(async () => { await Promise.resolve(); });
    expect(chatCalls()).toEqual([]);
    await waitFor(() =>
      expect(useBrowserStore.getState().messages[CHAT]?.some((m) =>
        m.content.includes('No webview available'),
      )).toBe(true),
    );
  });
});
