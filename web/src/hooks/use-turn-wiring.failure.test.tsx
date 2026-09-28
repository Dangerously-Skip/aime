// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTurnWiring } from './use-turn-wiring';
import { useSSEStream } from './use-sse-stream';
import { useRunStore } from '@/stores/run-store';
import { turnFailureFromEvent, reportTurnEvent } from '@/lib/runs/turn-outcome';

/**
 * A failed turn is recorded as FAILED.
 *
 * The regression: a no-API-key chat showed "Succeeded" in Recent Activity. The
 * server reports the failure as an SSE `error` event and then ends the stream
 * normally, so the stream hook calls `onDone` — and every surface's `onDone`
 * calls `runRecorder.succeed()`.
 *
 * Driven through the REAL stream hook and the real run store, wired exactly the
 * way the surfaces wire them. Only the network is faked: the SSE body, and the
 * run-log POST.
 */

const CHAT = 'conv-1';

function sse(frames: object[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

let chatResponse: () => Response;
const logged: unknown[] = [];

beforeEach(() => {
  logged.length = 0;
  useRunStore.setState({ runs: [], goals: [] });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/runs') {
      logged.push(JSON.parse(String(init?.body)).run);
      return new Response('{}', { status: 200 });
    }
    return chatResponse();
  }));
});

afterEach(() => vi.unstubAllGlobals());

/** A surface in miniature: the same three calls every surface makes. */
function useSurface(chatId = CHAT) {
  const { runRecorder } = useTurnWiring({ surfaceId: 'chat', chatId, ownsChat: (id) => id === chatId });
  const { sendMessage } = useSSEStream({
    chatId,
    setIsStreaming: () => {},
    onUsage: runRecorder.onUsage,
    onChunk: () => {},
    onDone: () => runRecorder.succeed(),
    onError: (e) => runRecorder.fail(e.message),
  });
  return { runRecorder, sendMessage };
}

async function runTurn(frames: object[], chatId = CHAT) {
  chatResponse = () => sse(frames);
  const { result } = renderHook(() => useSurface(chatId));
  let id = '';
  act(() => {
    id = result.current.runRecorder.begin({ trigger: 'chat' });
  });
  await act(async () => {
    await result.current.sendMessage('hi', chatId, 'chat', null);
  });
  return useRunStore.getState().getRun(id);
}

describe('a turn that reports a failure', () => {
  it('is recorded as failed, with the reason — not "Succeeded"', async () => {
    const run = await runTurn([
      { type: 'error', code: 'auth', message: 'No API key configured' },
    ]);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('No API key configured');
    // …and the durable log gets the same verdict the live view shows.
    expect(logged).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('is failed even when a done event with usage follows the error', async () => {
    const run = await runTurn([
      { type: 'text', content: 'partial' },
      { type: 'error', code: 'overloaded', message: 'Overloaded' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 1, cost: 0, model: 'm', durationMs: 5, toolCallCount: 0 } },
    ]);
    expect(run?.status).toBe('failed');
  });

  it('is failed for a done flagged as an error', async () => {
    const run = await runTurn([{ type: 'done', error: true, message: 'Turn failed' }]);
    expect(run?.status).toBe('failed');
  });

  it('a clean turn still succeeds', async () => {
    const run = await runTurn([{ type: 'text', content: 'hello' }]);
    expect(run?.status).toBe('succeeded');
  });

  it('another conversation’s failure does not fail this run', () => {
    const { result } = renderHook(() => useSurface(CHAT));
    let id = '';
    act(() => {
      id = result.current.runRecorder.begin({ trigger: 'chat' });
    });
    act(() => reportTurnEvent('someone-else', { type: 'error', message: 'boom' }));
    act(() => result.current.runRecorder.succeed());
    expect(useRunStore.getState().getRun(id)?.status).toBe('succeeded');
  });

  it('a failure in one turn does not leak into the next', () => {
    const { result } = renderHook(() => useSurface(CHAT));
    act(() => {
      result.current.runRecorder.begin({ trigger: 'chat' });
    });
    act(() => reportTurnEvent(CHAT, { type: 'error', message: 'boom' }));
    act(() => result.current.runRecorder.succeed());
    let second = '';
    act(() => {
      second = result.current.runRecorder.begin({ trigger: 'chat' });
    });
    act(() => result.current.runRecorder.succeed());
    expect(useRunStore.getState().getRun(second)?.status).toBe('succeeded');
  });
});

describe('turnFailureFromEvent', () => {
  it('reads the typed code, and classifies an untyped message', () => {
    expect(turnFailureFromEvent({ type: 'error', code: 'billing', message: 'x' })).toEqual({ code: 'billing', message: 'x' });
    expect(turnFailureFromEvent({ type: 'error', message: 'Invalid API key' })?.code).toBe('auth');
  });

  it('words a failure that arrived without a message', () => {
    expect(turnFailureFromEvent({ type: 'error', code: 'no_model' })?.message).toBe('No model is set up yet');
  });

  it('ignores every other event', () => {
    for (const type of ['text', 'done', 'tool_use', 'retry']) {
      expect(turnFailureFromEvent({ type })).toBeNull();
    }
  });
});
