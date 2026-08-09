// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ChatSurface } from './chat-surface';
import { useChatStore } from '@/stores/chat-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useRunStore } from '@/stores/run-store';
import { streamRegistry } from '@/lib/stream-registry';

/**
 * The real Chat surface, driven through its own composer, against the real chat
 * store, the real run store and the real SSE hook. Two defects only show up at
 * this level:
 *
 * DEFECT 5c — `onDone` / `onError` read `getChatId()`, i.e. whichever conversation
 *   is on screen NOW. A stream that fails after the user has moved on therefore
 *   wrote its `**Error:**` text into the wrong conversation. It must land on the
 *   chat the stream was started for.
 * DEFECT 5a — `runRecorder.succeed()/fail()` live only in those two callbacks, and
 *   an aborted fetch reaches neither, so Stop left the Run 'running' for ever.
 */

/** Headers arrive, then the body goes silent — what an inactivity timeout detects. */
function stalledBodyFetch(_url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal as AbortSignal;
  const reader = {
    read: () =>
      new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
    cancel: () => Promise.resolve(),
  };
  return Promise.resolve({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response);
}

const CHAT = 'conv-a';
const OTHER = 'conv-b';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = () => {};
  fetchMock.mockImplementation((url: string, init: RequestInit) =>
    String(url).includes('/api/chat/')
      ? stalledBodyFetch(url, init)
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  useRunStore.setState({ runs: [], goals: [] });
  useChatStore.setState({ messages: {}, currentChatId: CHAT, isStreaming: false });
  useConversationStore.setState({ conversations: [], activeId: null });
  for (const id of [CHAT, OTHER]) {
    useConversationStore.getState().addConversation({
      id,
      title: id,
      surface: 'chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Type into the composer and send, leaving a stream in flight. */
async function send(text: string) {
  const box = screen.getByPlaceholderText(/How can I help you today\?|Reply\.\.\./);
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
  });
}

const lastContent = (chatId: string) =>
  (useChatStore.getState().messages[chatId] ?? []).at(-1)?.content ?? '';

const activeRun = () => useRunStore.getState().runs[0];

/**
 * Leaves a stream in flight and moves the app on to another conversation the way
 * a cross-surface detour does: the surface goes away (streams deliberately outlive
 * it — see stream-registry), the user picks a different chat elsewhere, and
 * `currentChatId` is something else by the time the abandoned stream gives up.
 *
 * Switching conversation *while* the surface is mounted aborts the old stream
 * instead, which is why that path never exposed this.
 */
async function sendThenLeaveFor(text: string, next: string) {
  const mounted = render(<ChatSurface />);
  await send(text);
  expect(useChatStore.getState().messages[CHAT]?.length).toBeGreaterThan(0);
  mounted.unmount();
  act(() => useChatStore.getState().setCurrentChat(next));
}

describe('ChatSurface — a failing stream reports to the conversation it belongs to', () => {
  it('appends the timeout error to the chat the stream started for, not the one on screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await sendThenLeaveFor('summarise the doc', OTHER);
    useChatStore.getState().addMessage(OTHER, {
      id: 'other-1',
      role: 'assistant',
      content: 'unrelated work',
      timestamp: Date.now(),
    });

    // The abandoned stream now times out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(lastContent(CHAT)).toContain('**Error:**');
    expect(lastContent(CHAT)).toMatch(/the turn was stopped/i);
    // The conversation the user is actually reading is untouched.
    expect(lastContent(OTHER)).toBe('unrelated work');
  });

  it('clears the spinner on the conversation that failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await sendThenLeaveFor('summarise the doc', OTHER);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    const last = (useChatStore.getState().messages[CHAT] ?? []).at(-1);
    expect(last?.isStreaming).toBeFalsy();
    expect(last?.isLoading).toBeFalsy();
  });
});

describe('ChatSurface — an answered connect card stays answered (DEFECT 2)', () => {
  /** The surface as the stream leaves it: a paused turn waiting on a connection. */
  function seedConnectorRequest() {
    useChatStore.getState().addMessage(CHAT, {
      id: 'tu-9',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      connectorRequest: {
        connectorId: 'atlassian',
        reason: 'to read the ticket',
        toolUseId: 'tu-9',
      },
    });
  }

  const settled = () =>
    useChatStore.getState().messages[CHAT]?.find((m) => m.id === 'tu-9')?.connectorRequestSettled;

  it('records the answer on the message, so it survives leaving the conversation', async () => {
    seedConnectorRequest();
    const mounted = render(<ChatSurface />);
    expect(screen.getByText('Connect Atlassian?')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Not now'));
    });
    expect(settled()).toBe(true);

    // Come back to it: the buttons must not be live again, because clicking one
    // would re-run the whole flow and report to a turn that no longer exists.
    mounted.unmount();
    render(<ChatSurface />);
    expect(screen.getByText('Connect Atlassian?')).toBeTruthy();
    expect(screen.queryByText('Not now')).toBeNull();
    expect(screen.queryByText('Connect')).toBeNull();
  });
});

describe('ChatSurface — Stop closes the Run (DEFECT 5a)', () => {
  it('records a cancelled Run rather than leaving it running for ever', async () => {
    render(<ChatSurface />);
    await send('do the thing');
    expect(activeRun()?.status).toBe('running');

    // What the Stop button and the conversation-switch effect both call.
    await act(async () => {
      streamRegistry.abort(CHAT);
      await Promise.resolve();
    });

    expect(activeRun()?.status).toBe('cancelled');
    expect(activeRun()?.endedAt).toBeTypeOf('number');
  });

  it('records a timeout abort as a timeout', async () => {
    render(<ChatSurface />);
    await send('do the thing');

    await act(async () => {
      streamRegistry.abort(CHAT, 'timeout');
      await Promise.resolve();
    });

    expect(activeRun()?.status).toBe('timeout');
  });
});
