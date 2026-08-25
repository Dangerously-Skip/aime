import { describe, it, expect, vi } from 'vitest';
import { readTurnEvents, StreamInactivityError } from './turn-events';

/**
 * Two contracts: EVERY well-formed `data:` line reaches the handler exactly
 * once (the assistant surface's hand-rolled copy parsed and DROPPED non-text
 * events), and genuine silence throws instead of hanging forever (a wedged
 * stream used to leave the surface streaming eternally).
 *
 * Framing itself is delegated to parseSSELines and tested there; these cover
 * the pull-loop around it.
 */

const encoder = new TextEncoder();

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

/** A stream that enqueues on demand; tests decide when (or whether) to close. */
function manualStream() {
  let enqueue!: (s: string) => void;
  let close!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      enqueue = (s) => controller.enqueue(encoder.encode(s));
      close = () => controller.close();
    },
  });
  return { body, enqueue, close };
}

const sse = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

type Seen = Array<Record<string, unknown>>;

describe('event delivery', () => {
  it('delivers every event type, not just text', async () => {
    const seen: Seen = [];
    await readTurnEvents(
      streamFrom([
        sse({ type: 'text', content: 'hello ' }),
        sse({ type: 'error', message: 'boom' }),
        sse({ type: 'done' }),
      ]),
      (e) => seen.push(e),
    );
    expect(seen.map((e) => e.type)).toEqual(['text', 'error', 'done']);
  });

  it('reassembles an event split across two network chunks', async () => {
    const seen: Seen = [];
    const first = `data: ${JSON.stringify({ type: 'text', content: 'split' })}`;
    await readTurnEvents(
      // First chunk ends MID-LINE; the remainder arrives in the second chunk.
      streamFrom([first.slice(0, 12), `${first.slice(12)}\n\n`]),
      (e) => seen.push(e),
    );
    expect(seen).toEqual([{ type: 'text', content: 'split' }]);
  });

  it('skips a malformed frame without losing the rest of the stream', async () => {
    const seen: Seen = [];
    await readTurnEvents(
      streamFrom([sse({ type: 'a' }), 'data: {broken json\n\n', sse({ type: 'c' })]),
      (e) => seen.push(e),
    );
    expect(seen.map((e) => e.type)).toEqual(['a', 'c']);
  });

  it('stops at a [DONE] sentinel rather than reading what follows', async () => {
    const seen: Seen = [];
    await readTurnEvents(
      streamFrom([sse({ type: 'a' }), 'data: [DONE]\n\n', sse({ type: 'after-sentinel' })]),
      (e) => seen.push(e),
    );
    expect(seen.map((e) => e.type)).toEqual(['a']);
  });
});

describe('the inactivity backstop', () => {
  it('throws StreamInactivityError when no bytes arrive in time', async () => {
    vi.useFakeTimers();
    try {
      const { body } = manualStream(); // never enqueues, never closes
      const promise = readTurnEvents(body, () => {}, { inactivityTimeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toThrow(StreamInactivityError);
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('heartbeat comments reset the timer — only genuine silence trips it', async () => {
    const { body, enqueue, close } = manualStream();
    const seen: Seen = [];
    // A heartbeat comment every 50ms for 400ms against a 200ms budget: bytes
    // keep arriving (like the server's ~15s heartbeats), so this must resolve.
    const pacer = setInterval(() => enqueue(': keepalive\n\n'), 50);
    setTimeout(() => { clearInterval(pacer); close(); }, 400);
    await expect(
      readTurnEvents(body, (e) => seen.push(e), { inactivityTimeoutMs: 200 }),
    ).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('without a timeout configured, a silent stream waits indefinitely', async () => {
    const { body } = manualStream();
    let settled = false;
    void readTurnEvents(body, () => {}).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 100));
    expect(settled).toBe(false);
  });
});
