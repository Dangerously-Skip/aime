// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/*
 * Every /api/chat stream comes through useSSEStream, so this is where a turn's
 * memories get collected — on every surface, without any surface opting in.
 */
const pull = vi.hoisted(() => vi.fn(async () => 0));
vi.mock('@/lib/memory/pending-pull', () => ({ pullPendingMemories: pull, AFTER_TURN_WAIT_MS: 25_000 }));

import { useSSEStream } from './use-sse-stream';

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

function setup() {
  const handlers = {
    onChunk: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
    setIsStreaming: vi.fn(),
  };
  const { result } = renderHook(() => useSSEStream({ ...handlers, chatId: 'chat1' }));
  return { handlers, stream: result.current };
}

beforeEach(() => {
  pull.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('after a turn, pending memories are pulled', () => {
  it('once the turn is done, asking the server to wait for its extraction', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"type":"text","content":"hi"}\n\n', 'data: {"type":"done"}\n\n']),
    );
    const { handlers, stream } = setup();
    await stream.sendMessage('hi', 'chat1', 'cowork', 'sonnet');

    expect(handlers.onDone).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledWith({ waitMs: 25_000 });
  });

  it('not for a turn that failed before streaming', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }), text: async () => 'boom' });
    const { handlers, stream } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await stream.sendMessage('hi', 'chat1', 'chat', 'sonnet');

    expect(handlers.onError).toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
  });
});
