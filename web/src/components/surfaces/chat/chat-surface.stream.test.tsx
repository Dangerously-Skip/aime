// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { ChatSurface } from './chat-surface';
import { useChatStore } from '@/stores/chat-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useRunStore } from '@/stores/run-store';
import { useComposerDrafts } from '@/components/shared/composer/draft-store';
import { streamRegistry } from '@/lib/stream-registry';
import { resetServerCredentials } from '@/hooks/use-builtin-access';
import { useAppStore } from '@/stores/app-store';
import { useSettingsStore } from '@/stores/settings-store';

/** What /api/models reports about server-side credentials, per test. */
let serverCreds = { anthropic: true, bedrock: false };

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

/**
 * A body the test writes into: `push` an SSE event, `end` the stream. Lets a
 * test switch conversation between two chunks of the same reply.
 */
function controllableFetch() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  const enc = new TextEncoder();
  return {
    fetch: () => Promise.resolve(new Response(body, { status: 200 })),
    push: (event: Record<string, unknown>) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)),
    end: () => ctrl.close(),
  };
}

/** Let the reader loop drain what has been pushed. */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

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
  serverCreds = { anthropic: true, bedrock: false };
  resetServerCredentials();
  fetchMock.mockClear();
  fetchMock.mockImplementation((url: string, init: RequestInit) =>
    String(url).includes('/api/chat/')
      ? stalledBodyFetch(url, init)
      : String(url).includes('/api/models')
        ? Promise.resolve(new Response(JSON.stringify(serverCreds), { status: 200 }))
        : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  useRunStore.setState({ runs: [], goals: [] });
  useComposerDrafts.setState({ drafts: {}, lastSent: {} });
  useChatStore.setState({ messages: {}, currentChatId: CHAT, isStreaming: false, streamingChats: {} });
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

    const failed = (useChatStore.getState().messages[CHAT] ?? []).at(-1);
    expect(failed?.error?.code).toBe('timeout');
    expect(failed?.error?.message).toMatch(/the turn was stopped/i);
    // On the reply as a banner, not written into it (it would go back to the
    // model as history).
    expect(failed?.content).not.toContain('**Error:**');
    // The conversation the user is actually reading is untouched.
    expect(lastContent(OTHER)).toBe('unrelated work');
    expect((useChatStore.getState().messages[OTHER] ?? []).at(-1)?.error).toBeUndefined();
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

describe('ChatSurface — a reply stays in the conversation it was asked in', () => {
  it('text arriving after a mid-stream conversation switch lands in the original chat', async () => {
    const stream = controllableFetch();
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/api/chat/')
        ? stream.fetch()
        : Promise.resolve(new Response(JSON.stringify(serverCreds))),
    );
    useChatStore.getState().addMessage(OTHER, {
      id: 'other-1', role: 'assistant', content: 'unrelated work', timestamp: Date.now(),
    });
    render(<ChatSurface />);
    await send('write a poem');

    await act(async () => { stream.push({ type: 'text', content: 'Roses ' }); await flush(); });
    // The user opens another conversation while the reply is still arriving.
    await act(async () => { useChatStore.getState().setCurrentChat(OTHER); });
    await act(async () => {
      stream.push({ type: 'text', content: 'are red' });
      stream.end();
      await flush();
    });

    expect(lastContent(CHAT)).toBe('Roses are red');
    expect(lastContent(OTHER)).toBe('unrelated work');
  });
});

/** The request bodies the surface sent to the chat route. */
const chatBodies = () =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).includes('/api/chat/'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

describe('ChatSurface — Try again regenerates', () => {
  it('replaces the failed reply and resends the same question, without duplicating it', async () => {
    const failing = controllableFetch();
    fetchMock.mockImplementation((url: string, init: RequestInit) =>
      !String(url).includes('/api/chat/')
        ? Promise.resolve(new Response(JSON.stringify(serverCreds)))
        : chatBodies().length === 1
          ? failing.fetch()
          : stalledBodyFetch(url, init),
    );
    render(<ChatSurface />);
    await send('what is 2+2?');
    await act(async () => {
      failing.push({ type: 'error', message: 'Overloaded', code: 'overloaded' });
      failing.end();
      await flush();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/overloaded/i);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
      await flush();
    });

    const msgs = useChatStore.getState().messages[CHAT];
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0].content).toBe('what is 2+2?');
    expect(msgs[1].error).toBeUndefined();
    expect(msgs[1].isStreaming).toBe(true);
    const bodies = chatBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].message).toBe('what is 2+2?');
    // History is what came BEFORE the question — not the question, not the error.
    expect(bodies[1].history).toBeUndefined();
    streamRegistry.abort(CHAT);
  });
});

describe('ChatSurface — slash commands are not conversation', () => {
  it('a command and its confirmation are shown but never sent to the model as history', async () => {
    render(<ChatSurface />);
    await send('/reasoning off');
    expect(useChatStore.getState().messages[CHAT].map((m) => m.isCommandEcho)).toEqual([true, true]);
    expect(useChatStore.getState().sessionControls[CHAT]?.reasoningVisible).toBe(false);

    await send('real question');
    const [body] = chatBodies();
    expect(body.message).toBe('real question');
    expect(body.history).toBeUndefined();
    streamRegistry.abort(CHAT);
  });
});

describe('ChatSurface — the title is set once', () => {
  it('titles an untitled chat from the first message and keeps it after that', async () => {
    useConversationStore.getState().updateConversation(CHAT, { title: 'New Chat' });
    render(<ChatSurface />);
    await send('Plan a trip to Lisbon');
    streamRegistry.abort(CHAT);
    await act(async () => { await flush(); });
    await send('ok thanks');
    const conv = useConversationStore.getState().conversations.find((c) => c.id === CHAT);
    expect(conv?.title).toBe('Plan a trip to Lisbon');
    // The preview still follows the latest message.
    expect(conv?.lastMessage).toBe('ok thanks');
    streamRegistry.abort(CHAT);
  });

  it('never renames a chat that already has a name', async () => {
    useConversationStore.getState().updateConversation(CHAT, { title: 'Quarterly report' });
    render(<ChatSurface />);
    await send('draft the intro');
    expect(useConversationStore.getState().conversations.find((c) => c.id === CHAT)?.title).toBe('Quarterly report');
    streamRegistry.abort(CHAT);
  });
});

describe('ChatSurface — edit and resend, copy', () => {
  function seed() {
    const add = useChatStore.getState().addMessage;
    add(CHAT, { id: 'u1', role: 'user', content: 'first question', timestamp: 1 });
    add(CHAT, { id: 'a1', role: 'assistant', content: 'first answer', timestamp: 2 });
    add(CHAT, { id: 'u2', role: 'user', content: 'second question', timestamp: 3 });
    add(CHAT, { id: 'a2', role: 'assistant', content: 'second answer', timestamp: 4 });
  }

  it('editing a question replaces it and everything after it, and asks again', async () => {
    seed();
    render(<ChatSurface />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit and resend' })[0]);
    fireEvent.change(screen.getByLabelText('Edit message'), { target: { value: 'better question' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
      await flush();
    });

    const msgs = useChatStore.getState().messages[CHAT];
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ['user', 'better question'],
      ['assistant', ''],
    ]);
    const [body] = chatBodies();
    expect(body.message).toBe('better question');
    expect(body.history).toBeUndefined();
    streamRegistry.abort(CHAT);
  });

  it('copies a user message', async () => {
    seed();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<ChatSurface />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy message' })[1]);
    expect(writeText).toHaveBeenCalledWith('second question');
  });
});

describe('ChatSurface — nothing configured to answer', () => {
  it('shows Connect a model instead of sending a turn that can only fail', async () => {
    serverCreds = { anthropic: false, bedrock: false };
    const openSettings = vi.fn();
    useAppStore.setState({ openSettings } as never);
    render(<ChatSurface />);
    // The server's answer lands; with no key and no provider there is no model.
    await act(async () => { await flush(); });
    expect(screen.getByText('No model is set up yet')).toBeTruthy();

    await send('hello?');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/chat/'))).toBe(false);
    expect(useChatStore.getState().messages[CHAT] ?? []).toHaveLength(0);
    // The question is kept for when a model is connected.
    expect((screen.getByPlaceholderText('How can I help you today?') as HTMLTextAreaElement).value).toBe('hello?');
    expect(screen.getByRole('alert').textContent).toMatch(/No model is set up yet/);

    fireEvent.click(screen.getByRole('button', { name: 'Connect a model' }));
    expect(openSettings).toHaveBeenCalledWith('connectors');
  });

  it('still runs session commands, which need no model', async () => {
    serverCreds = { anthropic: false, bedrock: false };
    render(<ChatSurface />);
    await act(async () => { await flush(); });
    await send('/think high');
    expect(useChatStore.getState().sessionControls[CHAT]?.thinkLevel).toBe('high');
  });
});

describe('ChatSurface — the composer keeps focus across the first message', () => {
  it('the docked composer has focus after the empty-state composer sends', async () => {
    render(<ChatSurface />);
    await send('hello');
    // The empty-state composer is gone; the one under the transcript must be
    // where the next keystroke goes.
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Reply...'));
    streamRegistry.abort(CHAT);
  });
});

describe('ChatSurface — streaming is per conversation', () => {
  it('a second conversation can send while the first is still streaming, and Stop only stops its own', async () => {
    // Every chat request stalls, so both turns stay in flight.
    render(<ChatSurface />);
    useChatStore.getState().addMessage(OTHER, {
      id: 'b0', role: 'assistant', content: 'earlier', timestamp: Date.now(),
    });
    await send('long research in A');
    expect(streamRegistry.has(CHAT)).toBe(true);

    await act(async () => { useChatStore.getState().setCurrentChat(OTHER); });
    // B is idle: its button sends rather than offering a Stop for A's turn.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    await send('quick question in B');
    expect(streamRegistry.has(OTHER), 'B could not send while A streamed').toBe(true);
    expect(streamRegistry.has(CHAT), 'sending in B killed A').toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      await Promise.resolve();
    });
    expect(streamRegistry.has(OTHER)).toBe(false);
    expect(streamRegistry.has(CHAT), 'Stop in B stopped A').toBe(true);
    expect(useChatStore.getState().streamingChats[CHAT]).toBe(true);
    expect(useChatStore.getState().streamingChats[OTHER]).toBeUndefined();

    streamRegistry.abort(CHAT);
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

/**
 * "It seems if I open a new chat the running query in the current chat dies. I
 * would want to be able to have multiple chats concurrently."
 *
 * Switching conversations called `streamRegistry.abort(prevId)`, justified by a
 * comment about chunks landing in the wrong conversation. That concern was real
 * and had already been solved elsewhere: `useSSEStream` pins its callbacks at
 * stream start, which is what the test above this one asserts. So the abort was
 * doing nothing except killing work — a long research turn could not be left to
 * run while you did anything else.
 *
 * A registry keyed by chatId exists precisely so several can be in flight.
 */
describe('a running turn survives switching conversations', () => {
  it('does not abort the previous conversation on switch', async () => {
    render(<ChatSurface />);
    await send('a long research task');
    expect(streamRegistry.has(CHAT)).toBe(true);

    // Switched while the surface is mounted — the path that used to abort.
    await act(async () => {
      useConversationStore.getState().setActiveConversation(OTHER);
    });
    expect(useChatStore.getState().currentChatId).toBe(OTHER);
    expect(streamRegistry.has(CHAT), 'switching conversations killed the running turn').toBe(true);
  });

  /** Stop must still work — this removes an automatic abort, not the manual one. */
  it('still lets the user stop a turn deliberately', async () => {
    render(<ChatSurface />);
    await send('a long research task');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    expect(streamRegistry.has(CHAT)).toBe(false);
  });
});

/*
 * Chat once sent none of the settings half of a turn: a chosen deck theme never
 * reached the model (every deck came back an unstyled pptx) and search resolved
 * to `none`. See surface-settings-parity.test.ts for the structure that keeps it.
 */
describe('ChatSurface — a turn carries the user’s settings', () => {
  it('sends the deck theme, search and security settings', async () => {
    useSettingsStore.setState({ deckTheme: 'magazine-bold', blockNetworkCommands: true } as never);
    render(<ChatSurface />);
    await send('make me a deck');
    const [body] = chatBodies();
    expect(body.deckTheme).toMatchObject({ id: 'magazine-bold' });
    expect(body.searchSettings).toBeDefined();
    expect(body.securitySettings).toMatchObject({ blockNetworkCommands: true });
    useSettingsStore.setState({ deckTheme: null, blockNetworkCommands: false } as never);
  });
});
