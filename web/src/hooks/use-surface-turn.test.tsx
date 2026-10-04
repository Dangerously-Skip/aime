// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useSurfaceTurn, type TurnSurfaceId, type TurnStore } from './use-surface-turn';
import { handOffTurn, useHandoffStore } from './use-handoff-turn';
import { resetServerCredentials } from './use-builtin-access';
import { Composer } from '@/components/shared/composer/composer';
import { MessageList } from '@/components/shared/message-list';
import { useComposerDrafts } from '@/components/shared/composer/draft-store';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useCodeStore } from '@/stores/code-store';
import { useBrowserStore } from '@/stores/browser-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useRunStore } from '@/stores/run-store';
import { streamRegistry } from '@/lib/stream-registry';
import { getSurfaceRoute } from '@/lib/models/surface-routes';

/**
 * THE turn path, driven on every transcript store it serves.
 *
 * Chat and Cowork got the phase-1 fixes — the typed error banner, Retry that
 * regenerates, per-chat streaming, the title set once, "Connect a model" — and
 * Code and Browser did not, because each surface had its own copy of the turn.
 * There is one copy now, and this runs it against all four stores through the
 * real Composer, the real MessageList and the real SSE hook. Only `fetch` is
 * faked: each chat request gets a body the test writes into.
 *
 * `chat-surface.stream.test.tsx` and `cowork-surface.stream.test.tsx` cover
 * what is specific to those surfaces; this is what they now share.
 */

const STORES: Array<{ surface: TurnSurfaceId; store: TurnStore }> = [
  { surface: 'chat', store: useChatStore },
  { surface: 'cowork', store: useCoworkStore },
  { surface: 'code', store: useCodeStore },
  { surface: 'browser', store: useBrowserStore },
];

const A = 'conv-a';
const B = 'conv-b';

/** A response body the test writes into, which errors when the request is aborted, as a real one does. */
function controllableStream(signal?: AbortSignal) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  signal?.addEventListener('abort', () => {
    try { ctrl.error(signal.reason); } catch { /* already closed */ }
  });
  const enc = new TextEncoder();
  return {
    response: new Response(body, { status: 200 }),
    push: (event: Record<string, unknown>) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)),
    end: () => ctrl.close(),
  };
}

let streams: Array<ReturnType<typeof controllableStream>> = [];
let serverCreds = { anthropic: true, bedrock: false };
const fetchMock = vi.fn();
const onCanvas = vi.fn();

const chatBodies = () =>
  fetchMock.mock.calls
    .filter(([u]) => String(u).includes('/api/chat/'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

function Harness({ surface, store }: { surface: TurnSurfaceId; store: TurnStore }) {
  const turn = useSurfaceTurn({
    surface,
    label: surface,
    store,
    capability: getSurfaceRoute(surface).capability,
    modelRoute: null,
    onCanvas,
  });
  return (
    <>
      <MessageList {...turn.transcript} />
      <Composer {...turn.composer} placeholder="Say something" />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  streams = [];
  serverCreds = { anthropic: true, bedrock: false };
  resetServerCredentials();
  onCanvas.mockClear();
  fetchMock.mockReset().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes('/api/chat/')) {
      const s = controllableStream(init?.signal ?? undefined);
      streams.push(s);
      return Promise.resolve(s.response);
    }
    if (String(url).includes('/api/models')) return Promise.resolve(new Response(JSON.stringify(serverCreds)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  useRunStore.setState({ runs: [], goals: [] });
  useComposerDrafts.setState({ drafts: {}, lastSent: {} });
  useHandoffStore.setState({ turns: {} });
  for (const { store } of STORES) {
    (store as unknown as { setState: (s: object) => void }).setState({
      messages: {}, currentChatId: A, isStreaming: false, streamingChats: {},
    });
  }
});

afterEach(() => {
  cleanup();
  for (const id of [A, B]) streamRegistry.abort(id, 'user');
  vi.unstubAllGlobals();
});

describe.each(STORES)('useSurfaceTurn — $surface', ({ surface, store }) => {
  const msgs = (id = A) => store.getState().messages[id] ?? [];
  const conv = (id: string) => useConversationStore.getState().conversations.find((c) => c.id === id);

  beforeEach(() => {
    useConversationStore.setState({ conversations: [], activeId: null });
    for (const id of [A, B]) {
      useConversationStore.getState().addConversation({
        id, title: 'New Chat', surface, lastMessage: '', createdAt: 1, updatedAt: 1,
      });
    }
  });

  async function send(text: string) {
    const box = screen.getByPlaceholderText('Say something');
    fireEvent.change(box, { target: { value: text } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
      await flush();
    });
  }

  it('a failed turn is a banner on the reply, not text in it, and Try again regenerates', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('what is 2+2?');
    await act(async () => {
      streams[0].push({ type: 'text', content: 'Let me think' });
      streams[0].push({ type: 'error', message: 'Overloaded', code: 'overloaded' });
      streams[0].end();
      await flush();
    });

    const failed = msgs().at(-1)!;
    expect(failed.error?.code).toBe('overloaded');
    expect(failed.content).not.toContain('**Error:**');
    expect(screen.getByRole('alert').textContent).toMatch(/overloaded/i);
    expect(useRunStore.getState().runs[0]).toMatchObject({ status: 'failed', surfaceId: surface });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
      await flush();
    });
    // The failed reply is replaced; the question is not asked twice.
    expect(msgs().map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs()[1].error).toBeUndefined();
    const bodies = chatBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].message).toBe(bodies[0].message);
    expect(bodies[1].history).toBeUndefined();
  });

  /*
   * Agent SDK 0.3 re-runs a refused reply on a fallback model; the provider
   * turns the SDK's retraction into a `retract` event. Every surface must take
   * the refused partial off the reply — which needs the store's segment
   * actions wired into the shared turn, not just to exist.
   */
  it('takes a retracted refusal off the reply, tool call and all', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('explain it');
    await act(async () => {
      streams[0].push({ type: 'text', content: 'Looking. ', segment: 'q:1' });
      streams[0].push({ type: 'tool_use', id: 'tu_ok', name: 'Read', input: {}, segment: 'q:1' });
      streams[0].push({ type: 'text', content: 'REFUSED partial', segment: 'q:2' });
      streams[0].push({ type: 'tool_use', id: 'tu_ref', name: 'Bash', input: {}, segment: 'q:2' });
      streams[0].push({ type: 'retract', segments: ['q:2'], toolUseIds: ['tu_ref'] });
      streams[0].push({ type: 'text', content: 'FALLBACK answer', segment: 'q:3' });
      streams[0].end();
      await flush();
      await new Promise((r) => setTimeout(r, 40));
    });
    const reply = msgs().at(-1)!;
    expect(reply.content).toBe('Looking. \n\nFALLBACK answer');
    expect(reply.toolCalls?.map((t) => t.id)).toEqual(['tu_ok']);
    expect(reply.segmentMarks).toBeUndefined();
  });

  it('shows the provider backing off, and clears it when output arrives', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('hello');
    await act(async () => {
      streams[0].push({ type: 'retry', attempt: 2, delayMs: 1000, code: 'rate_limit' });
      await flush();
    });
    expect(msgs().at(-1)?.retrying).toEqual({ attempt: 2, delayMs: 1000 });
    await act(async () => {
      streams[0].push({ type: 'text', content: 'Hi' });
      await flush();
      // Text is delivered at most once per animation frame.
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(msgs().at(-1)?.retrying).toBeUndefined();
  });

  it('streaming is per conversation: B can send while A streams, and Stop stops only B', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('long task in A');
    expect(streamRegistry.has(A)).toBe(true);

    await act(async () => { store.getState().setCurrentChat(B); });
    // B is not streaming, so it offers Send, not a Stop that would abort A.
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await send('quick question in B');
    expect(streamRegistry.has(B)).toBe(true);
    expect(streamRegistry.has(A), 'sending in B killed A').toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
      await flush();
    });
    expect(streamRegistry.has(B)).toBe(false);
    expect(streamRegistry.has(A), 'Stop in B stopped A').toBe(true);
    // One Run per conversation: B's is cancelled, A's is still running.
    const byStatus = useRunStore.getState().runs.map((r) => r.status).sort();
    expect(byStatus).toEqual(['cancelled', 'running']);
  });

  it('a reply lands in the conversation it was asked in, canvas included', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('draw a chart');
    await act(async () => { store.getState().setCurrentChat(B); });
    await act(async () => {
      streams[0].push({ type: 'text', content: 'Here it is' });
      streams[0].push({ type: 'canvas', doc: { title: 'Chart', components: [] } });
      streams[0].end();
      await flush();
    });
    expect(msgs(A).at(-1)?.content).toBe('Here it is');
    expect(msgs(B)).toHaveLength(0);
    // The canvas handler is told the STREAM's chat, not the one on screen.
    expect(onCanvas).toHaveBeenCalledWith(expect.objectContaining({ doc: expect.anything() }), A);
  });

  it('titles an untitled conversation once, and never renames it after', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('Plan a trip to Lisbon');
    await act(async () => { streams[0].end(); await flush(); });
    await send('ok thanks');
    expect(conv(A)?.title).toBe('Plan a trip to Lisbon');
    expect(conv(A)?.lastMessage).toBe('ok thanks');
  });

  it('a session command is applied and shown, never sent to the model', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('/think high');
    expect(chatBodies()).toHaveLength(0);
    expect(msgs().map((m) => m.isCommandEcho)).toEqual([true, true]);
    await send('real question');
    const [body] = chatBodies();
    expect((body.sessionControls as { thinkLevel?: string }).thinkLevel).toBe('high');
    expect(body.history).toBeUndefined();
    // A command is not a name.
    expect(conv(A)?.title).toBe('real question');
  });

  it('edit & resend replaces the question and everything after it', async () => {
    render(<Harness surface={surface} store={store} />);
    await send('first question');
    await act(async () => { streams[0].push({ type: 'text', content: 'first answer' }); streams[0].end(); await flush(); });
    const question = msgs()[0];

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));
    fireEvent.change(screen.getByLabelText('Edit message'), { target: { value: 'better question' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));
      await flush();
    });
    expect(msgs().map((m) => [m.role, m.content])).toEqual([
      ['user', 'better question'],
      ['assistant', ''],
    ]);
    expect(msgs()[0].id).not.toBe(question.id);
    expect(chatBodies()[1].message).toBe('better question');
  });

  it('with nothing to answer, says "Connect a model" and keeps the draft', async () => {
    serverCreds = { anthropic: false, bedrock: false };
    render(<Harness surface={surface} store={store} />);
    await act(async () => { await flush(); });
    expect(screen.getByText('No model is set up yet')).toBeTruthy();
    await send('hello?');
    expect(chatBodies()).toHaveLength(0);
    expect(msgs()).toHaveLength(0);
    expect((screen.getByPlaceholderText('Say something') as HTMLTextAreaElement).value).toBe('hello?');
    expect(screen.getByRole('alert').textContent).toMatch(/No model is set up yet/);
  });

  it('sends a message handed over from elsewhere once its conversation is on screen', async () => {
    render(<Harness surface={surface} store={store} />);
    act(() => handOffTurn(surface, B, { text: 'from the project page', attachments: [] }));
    await act(async () => { await flush(); });
    // Not sent into A just because it happened to be open.
    expect(chatBodies()).toHaveLength(0);

    await act(async () => {
      store.getState().setCurrentChat(B);
      await flush();
    });
    expect(chatBodies()).toHaveLength(1);
    expect(chatBodies()[0]).toMatchObject({ message: 'from the project page', chatId: B });
    expect(msgs(B)[0]).toMatchObject({ role: 'user', content: 'from the project page' });
    expect(useHandoffStore.getState().turns).toEqual({});
  });
});
