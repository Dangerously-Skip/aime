// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSSEStream, stripMessagesForHistory, type SSEEvent, type StreamUsage } from './use-sse-stream';
import { streamRegistry } from '@/lib/stream-registry';
import { useChatStore, type Message } from '@/stores/chat-store';

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const fetchMock = vi.fn();

function setup(chatId = 'chat1') {
  const handlers = {
    onChunk: vi.fn<(event: SSEEvent) => void>(),
    onError: vi.fn<(error: Error) => void>(),
    onDone: vi.fn<() => void>(),
    onUsage: vi.fn<(usage: StreamUsage) => void>(),
    setIsStreaming: vi.fn<(v: boolean) => void>(),
  };
  const { result } = renderHook(() => useSSEStream({ ...handlers, chatId }));
  return { handlers, stream: result.current };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stripMessagesForHistory', () => {
  it('keeps only non-empty user/assistant messages', () => {
    expect(
      stripMessagesForHistory([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '' },
        { role: 'system', content: 'internal' },
        { role: 'assistant', content: 'hello', extra: true } as never,
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });
});

describe('useSSEStream.sendMessage', () => {
  it('parses SSE frames into chunk events and calls onDone', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"text","content":"Hel"}\n\n',
        'data: {"type":"text","content":"lo"}\n\n',
      ]),
    );
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');

    expect(handlers.onChunk.mock.calls.map(([e]) => (e as SSEEvent).content)).toEqual(['Hel', 'lo']);
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(handlers.onError).not.toHaveBeenCalled();
    // streaming toggled on then off
    expect(handlers.setIsStreaming.mock.calls.map(([v]) => v)).toEqual([true, false]);
  });

  it('reassembles events split across network chunks', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"type":"text","con', 'tent":"joined"}\n\n']),
    );
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');
    expect(handlers.onChunk).toHaveBeenCalledTimes(1);
    expect((handlers.onChunk.mock.calls[0][0] as SSEEvent).content).toBe('joined');
  });

  it('ignores heartbeat comments and malformed JSON lines', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        ': heartbeat\n\n',
        'data: not-json\n\n',
        'data: {"type":"text","content":"ok"}\n\n',
      ]),
    );
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');
    expect(handlers.onChunk).toHaveBeenCalledTimes(1);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('stops on the [DONE] sentinel and does not deliver later events', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"text","content":"before"}\n\n',
        'data: [DONE]\n\n',
        'data: {"type":"text","content":"after"}\n\n',
      ]),
    );
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');
    expect(handlers.onChunk.mock.calls.map(([e]) => (e as SSEEvent).content)).toEqual(['before']);
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it('routes the done event with usage to onUsage instead of onChunk', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"text","content":"answer"}\n\n',
        'data: {"type":"input_request","question":"which one?"}\n\n',
        'data: {"type":"done","usage":{"inputTokens":10,"outputTokens":20,"cost":0.01,"model":"sonnet","durationMs":1500,"toolCallCount":2}}\n\n',
      ]),
    );
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');

    expect(handlers.onUsage).toHaveBeenCalledTimes(1);
    const usage = handlers.onUsage.mock.calls[0][0] as StreamUsage;
    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 20, toolCallCount: 2 });
    expect(usage.clarificationCount).toBe(1);
    expect(typeof usage.ttftMs).toBe('number'); // text event preceded done

    const chunkTypes = handlers.onChunk.mock.calls.map(([e]) => (e as SSEEvent).type);
    expect(chunkTypes).not.toContain('done');
  });

  it('sends the payload to the surface endpoint, omitting empty extras', async () => {
    fetchMock.mockResolvedValue(sseResponse([]));
    const { stream } = setup();

    await stream.sendMessage('the message', 'chat1', 'cowork', 'opus', {
      webSearch: true,
      sessionControls: { thinkLevel: 'high' },
      history: [],
      memories: '',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat/cowork');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      message: 'the message',
      chatId: 'chat1',
      model: 'opus',
      webSearch: true,
      sessionControls: { thinkLevel: 'high' },
    });
    expect(body.history).toBeUndefined();  // empty array omitted
    expect(body.memories).toBeUndefined(); // empty string omitted
  });

  it('reports HTTP errors via onError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal exploded',
    } as unknown as Response);
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect((handlers.onError.mock.calls[0][0] as Error).message).toContain('HTTP 500');
    expect(handlers.onDone).not.toHaveBeenCalled();
    expect(handlers.setIsStreaming).toHaveBeenLastCalledWith(false);
  });

  it('reports network failures via onError', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.setIsStreaming).toHaveBeenLastCalledWith(false);
  });

  it('delivers a trailing event even when the stream ends without a final newline', async () => {
    fetchMock.mockResolvedValue(sseResponse(['data: {"type":"text","content":"tail"}']));
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');
    expect(handlers.onChunk).toHaveBeenCalledTimes(1);
    expect((handlers.onChunk.mock.calls[0][0] as SSEEvent).content).toBe('tail');
  });

  it('aborts the in-flight request when sending again on the same chat', async () => {
    // First request hangs until aborted
    let firstSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      firstSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {"type":"text","content":"second"}\n\n']));

    const { handlers, stream } = setup();
    const first = stream.sendMessage('one', 'chat1', 'chat', 'sonnet');
    const second = stream.sendMessage('two', 'chat1', 'chat', 'sonnet');
    await Promise.all([first, second]);

    expect(firstSignal?.aborted).toBe(true);
    expect(handlers.onError).not.toHaveBeenCalled(); // AbortError is swallowed
    expect(handlers.onChunk.mock.calls.map(([e]) => (e as SSEEvent).content)).toEqual(['second']);
  });

  it('abort() cancels the active stream and stops streaming state', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });

    const { handlers, stream } = setup();
    const pending = stream.sendMessage('one', 'chat1', 'chat', 'sonnet');
    stream.abort();
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(handlers.setIsStreaming).toHaveBeenLastCalledWith(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Abort lifecycle, exercised against the REAL chat store.
//
// The store-level `isStreaming` boolean is not what renders a spinner — the
// per-message `isStreaming`/`isLoading` flags are, and only `stopStreaming()`
// clears them. Every test below therefore asserts the message-level outcome:
// that is the gap that let a stuck bubble ship.
// ───────────────────────────────────────────────────────────────────────────

/** A request that never resolves. Rejects with the signal's abort reason on
 *  abort — the platform's own behaviour for `fetch(…, { signal })`. */
function stalledFetch(_url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal as AbortSignal;
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason));
  });
}

/** Headers arrive, then the body goes silent — the shape an inactivity timeout
 *  has to detect. The pending read rejects with the abort reason, as a real
 *  body stream does. */
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

function lastMessage(chatId: string): Message {
  const msgs = useChatStore.getState().messages[chatId] ?? [];
  return msgs[msgs.length - 1];
}

/** Seeds a chat that is mid-turn: user message + streaming assistant placeholder. */
function seedStreamingChat(chatId: string) {
  useChatStore.setState({ messages: {}, currentChatId: chatId, isStreaming: false });
  const s = useChatStore.getState();
  s.addMessage(chatId, { id: `${chatId}-u`, role: 'user', content: 'do the thing', timestamp: Date.now() });
  s.addMessage(chatId, {
    id: `${chatId}-a`,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
    isLoading: true,
  });
  s.startStreaming(chatId);
}

/**
 * Wires the hook exactly the way the surfaces do: store setters for the
 * store-level flags, and onDone/onError that finalise message state and append
 * the visible `**Error:**` text (chat-surface.tsx:401-433).
 */
function setupWithStore(chatId: string) {
  const spies = {
    onDone: vi.fn(),
    onError: vi.fn<(e: Error) => void>(),
  };
  const { result } = renderHook(() =>
    useSSEStream({
      chatId,
      onChunk: (event) => {
        if (event.type === 'text') {
          useChatStore.getState().appendToLastAssistant(chatId, (event.content as string) ?? '');
        }
      },
      setIsStreaming: (v) => useChatStore.getState().setIsStreaming(v),
      onDone: () => {
        spies.onDone();
        useChatStore.getState().completeRunningTools(chatId);
        useChatStore.getState().stopStreaming(chatId);
      },
      onError: (e) => {
        spies.onError(e);
        useChatStore.getState().stopStreaming(chatId);
        useChatStore.getState().appendToLastAssistant(chatId, `\n\n**Error:** ${e.message}`);
      },
    }),
  );
  return { spies, stream: result.current };
}

describe('useSSEStream — aborted streams finalise message state', () => {
  afterEach(() => {
    vi.useRealTimers();
    // Nothing should still be registered, but never leak a controller into the
    // next test — a stale entry would be read as "superseded".
    for (const id of ['stop-chat', 'old-chat', 'timeout-chat', 'busy-chat', 'done-chat']) {
      streamRegistry.abort(id);
    }
  });

  it('a user Stop clears the message spinner, appends no error, and reports no timeout', async () => {
    fetchMock.mockImplementation(stalledFetch);
    seedStreamingChat('stop-chat');
    const { spies, stream } = setupWithStore('stop-chat');

    const pending = stream.sendMessage('go', 'stop-chat', 'chat', 'sonnet');
    stream.abort(); // the Stop button
    await pending;

    const last = lastMessage('stop-chat');
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(last.content).not.toContain('**Error:**');
    expect(spies.onError).not.toHaveBeenCalled();
    // cowork's onDone can auto-continue the turn — a deliberate Stop must not
    // take that path, or Stop would resurrect the stream it just killed.
    expect(spies.onDone).not.toHaveBeenCalled();
    // A user-initiated stop is not a timeout. Asserted on what the user can
    // actually see — the transcript — now that the write-only store field the
    // hook used to mirror errors into is gone.
    expect(last.content).not.toMatch(/timed out/i);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('a user Stop surfacing as a native AbortError is not misreported as a timeout', async () => {
    // What a browser hands back when the request is aborted without an explicit
    // reason. The old code inferred "inactivity timeout" from the abort having
    // already removed the registry entry, so a Stop reported a timeout.
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    seedStreamingChat('stop-chat');
    const { spies, stream } = setupWithStore('stop-chat');

    const pending = stream.sendMessage('go', 'stop-chat', 'chat', 'sonnet');
    stream.abort();
    await pending;

    const last = lastMessage('stop-chat');
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(last.content).not.toMatch(/timed out/i);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it('a conversation switch mid-stream clears the old chat without a spurious error', async () => {
    fetchMock.mockImplementation(stalledFetch);
    seedStreamingChat('old-chat');
    const { spies, stream } = setupWithStore('old-chat');

    const pending = stream.sendMessage('go', 'old-chat', 'chat', 'sonnet');
    // chat-surface.tsx:205 / cowork-surface.tsx:778 on conversation switch
    streamRegistry.abort('old-chat');
    await pending;

    const last = lastMessage('old-chat');
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(last.content).not.toContain('**Error:**');
    expect(last.content).not.toMatch(/timed out/i);
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it('a 120s inactivity timeout surfaces as an error and clears the message spinner', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(stalledBodyFetch);
    seedStreamingChat('timeout-chat');
    const { spies, stream } = setupWithStore('timeout-chat');

    const pending = stream.sendMessage('go', 'timeout-chat', 'chat', 'sonnet');
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;

    expect(spies.onError).toHaveBeenCalledTimes(1);
    expect(spies.onError.mock.calls[0][0].message).toMatch(/timed out/i);
    expect(spies.onDone).not.toHaveBeenCalled();

    const last = lastMessage('timeout-chat');
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    // `onError` is the ONLY route a timeout now takes to the user, so assert it
    // arrives in the transcript rather than only that the callback fired.
    expect(last.content).toMatch(/\*\*Error:\*\*[\s\S]*timed out/i);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('a superseded stream does not finalise the replacement turn', async () => {
    fetchMock.mockImplementation(stalledFetch);
    seedStreamingChat('busy-chat');
    const { spies, stream } = setupWithStore('busy-chat');

    const first = stream.sendMessage('one', 'busy-chat', 'chat', 'sonnet');
    const second = stream.sendMessage('two', 'busy-chat', 'chat', 'sonnet');
    await first; // the superseded stream settles while the replacement runs

    const last = lastMessage('busy-chat');
    expect(last.isStreaming).toBe(true); // the live turn keeps its spinner
    expect(useChatStore.getState().isStreaming).toBe(true);
    expect(spies.onDone).not.toHaveBeenCalled();
    expect(spies.onError).not.toHaveBeenCalled();

    stream.abort();
    await second;
    expect(lastMessage('busy-chat').isStreaming).toBe(false);
  });

  it('a stream that completes normally finalises exactly once', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"type":"text","content":"all done"}\n\n']),
    );
    seedStreamingChat('done-chat');
    const { spies, stream } = setupWithStore('done-chat');

    await stream.sendMessage('go', 'done-chat', 'chat', 'sonnet');

    expect(spies.onDone).toHaveBeenCalledTimes(1);
    expect(spies.onError).not.toHaveBeenCalled();
    const last = lastMessage('done-chat');
    expect(last.content).toBe('all done');
    expect(last.isStreaming).toBe(false);
    expect(last.isLoading).toBe(false);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });
});
