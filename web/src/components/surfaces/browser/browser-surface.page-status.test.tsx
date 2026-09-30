// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { BrowserSurface } from './browser-surface';
import { useBrowserStore } from '@/stores/browser-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { APP_NAME } from '@/config/branding';
import { resetServerCredentials } from '@/hooks/use-builtin-access';

/**
 * The Browser surface, driven through its real <webview> element's events and
 * its real composer:
 *  - a failed load shows what failed and offers Retry (it was a blank page);
 *  - a slow load shows progress;
 *  - while the agent drives the page, the page says so, and Take over stops it;
 *  - the icon-only toolbar buttons have names.
 */

const CHAT = 'browser-conv';
const fetchMock = vi.fn();

/** Headers arrive, body never does — a turn that stays running until aborted. */
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
  return Promise.resolve({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response);
}

async function navigate(url: string) {
  const bar = screen.getByLabelText('Address');
  await act(async () => {
    fireEvent.change(bar, { target: { value: url } });
    fireEvent.keyDown(bar, { key: 'Enter', code: 'Enter' });
  });
}

async function submit(text: string) {
  const box = screen.getByPlaceholderText(/ask|message|what/i) as HTMLTextAreaElement;
  await act(async () => { fireEvent.change(box, { target: { value: text } }); });
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' }); });
}

function webviewEvent(type: string, props: Record<string, unknown> = {}) {
  const wv = document.querySelector('webview')!;
  const ev = Object.assign(new Event(type), props);
  act(() => { wv.dispatchEvent(ev); });
  return wv;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  fetchMock.mockImplementation((url: string, init: RequestInit) =>
    String(url).includes('/api/chat/')
      ? stalledStream(init)
      // A model is set up, so a question is sent rather than refused.
      : String(url).includes('/api/models')
        ? Promise.resolve(new Response(JSON.stringify({ anthropic: true, bedrock: false }), { status: 200 }))
        : Promise.resolve(new Response('{}', { status: 200 })),
  );
  resetServerCredentials();
  vi.stubGlobal('fetch', fetchMock);
  useBrowserStore.setState({
    messages: {}, currentChatId: CHAT, isStreaming: false, streamingChats: {}, loopPhase: 'idle',
    tabSessions: {}, activeTabIds: {}, pendingContext: [],
  } as never);
  useConversationStore.setState({ conversations: [], activeId: null } as never);
  useConversationStore.getState().addConversation({
    id: CHAT, title: 'Browser', surface: 'browser', lastMessage: '', createdAt: Date.now(), updatedAt: Date.now(),
  });
  useSettingsStore.setState({ anthropicApiKey: 'sk-test' } as never);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('page load feedback', () => {
  it('a failed load shows what failed, the URL, and a working Retry', async () => {
    render(<BrowserSurface />);
    await navigate('https://nope.invalid');
    const wv = webviewEvent('did-fail-load', {
      errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED', validatedURL: 'https://nope.invalid/', isMainFrame: true,
    }) as unknown as { loadURL: (u: string) => Promise<void> };
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/can’t be found/);
    expect(alert.textContent).toContain('https://nope.invalid/');

    wv.loadURL = vi.fn(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(wv.loadURL).toHaveBeenCalledWith('https://nope.invalid/');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ERR_ABORTED (a redirect) is not an error', async () => {
    render(<BrowserSurface />);
    await navigate('https://example.com');
    webviewEvent('did-fail-load', { errorCode: -3, validatedURL: 'https://example.com/', isMainFrame: true });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows progress between did-start-loading and did-stop-loading', async () => {
    render(<BrowserSurface />);
    await navigate('https://example.com');
    webviewEvent('did-start-loading');
    expect(screen.getByRole('progressbar', { name: 'Loading page' })).toBeTruthy();
    webviewEvent('did-stop-loading');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('the agent says when it is driving the page', () => {
  it('shows the banner during a page run, and Take over stops it', async () => {
    render(<BrowserSurface />);
    await navigate('https://example.com');
    await submit('what is on this page?');
    await waitFor(() => expect(screen.getByText(`${APP_NAME} is controlling this page`)).toBeTruthy());
    const turn = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/chat/browser-turn'))!;
    const signal = (turn[1] as RequestInit).signal as AbortSignal;

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Take over/ })); });
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText(`${APP_NAME} is controlling this page`)).toBeNull());
    const msgs = useBrowserStore.getState().messages[CHAT] ?? [];
    expect(msgs.at(-1)?.content).toMatch(/You took over/);
  });

  it('no banner when nothing is running', () => {
    render(<BrowserSurface />);
    expect(screen.queryByText(`${APP_NAME} is controlling this page`)).toBeNull();
  });
});

describe('toolbar buttons have names', () => {
  it.each(['Back', 'Forward', 'Reload', 'Inspect element', 'Grab selected text', 'Take screenshot', 'New tab'])(
    '%s',
    (name) => {
      render(<BrowserSurface />);
      expect(screen.getByRole('button', { name })).toBeTruthy();
    },
  );
});
