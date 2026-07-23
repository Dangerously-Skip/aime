// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSSEStream, stripMessagesForHistory, type SSEEvent, type StreamUsage } from './use-sse-stream';

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
    setStreamError: vi.fn<(e: string | null) => void>(),
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

  it('reports HTTP errors via onError and setStreamError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal exploded',
    } as unknown as Response);
    const { handlers, stream } = setup();

    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');

    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect((handlers.onError.mock.calls[0][0] as Error).message).toContain('HTTP 500');
    expect(handlers.setStreamError).toHaveBeenLastCalledWith(expect.stringContaining('HTTP 500'));
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
