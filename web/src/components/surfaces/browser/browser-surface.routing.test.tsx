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

  it('mounts a webview with a REAL src before any navigation', () => {
    /*
     * The assertion the rest of this misses. Removing `|| 'about:blank'` leaves
     * the element mounted with `src=""` — the ref still populates, so every
     * other test here still passes while the browser loads nothing and every
     * tool fails against it. An Electron <webview> with an empty src renders
     * nothing at all; that is the same trap as the preview panel's blank box.
     */
    const { container } = render(<BrowserSurface />);
    const wv = container.querySelector('webview');
    expect(wv, 'no webview is mounted at all').toBeTruthy();
    expect(wv!.getAttribute('src')).toBe('about:blank');
  });

  it('offers them even before the user has navigated', async () => {
    /*
     * THIS ASSERTION USED TO BE ITS OWN OPPOSITE, and the change is deliberate.
     *
     * The webview used to render only after a navigation, so a fresh surface had
     * none and the tools were correctly withheld — offering a tool nothing can
     * execute is DR-21's loop one layer down.
     *
     * But that also meant AUTOMATION COULD NOT BROWSE: cron fires on the minute
     * tick in this renderer, every surface is mounted the whole time, and the
     * only thing missing was the browser inside this one. It is now mounted at
     * about:blank from the start, so something can always execute a tool.
     *
     * The DR-21 guarantee is not weakened, it moved: a click on a blank page
     * fails with "no snapshot has been taken", which is a fact the agent can act
     * on, rather than a tool that does not exist.
     */
    render(<BrowserSurface />);
    await submit('find me the cheapest flight to sydney');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/chat/browser'))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.browserToolsAvailable).toBe(true);
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

  it('answers a page question against the blank page rather than refusing', async () => {
    /*
     * Also inverted, for the same reason. There is always a webview now, so the
     * quick-ask loop always has something to ask about — it reaches its own
     * endpoint instead of bailing with "No webview available".
     *
     * What the user sees on a blank page is an honest "this page is empty",
     * which beats a refusal that reads like a broken feature.
     */
    render(<BrowserSurface />);
    await submit('what is on this page?');

    await waitFor(() => expect(chatCalls().length).toBeGreaterThan(0));
    expect(chatCalls()[0]).toContain('/api/chat/browser-turn');
  });
});
