'use client';

import { parseSSELines } from './parse-sse-lines';

/**
 * Read one SSE turn body to completion, dispatching every event.
 *
 * The Assistant surface hand-rolled this loop inline and it could only ever
 * learn about `text` events: every `error` the server sent — watchdog kills,
 * silence timeouts, model/auth failures — was parsed and silently dropped, so a
 * failed unattended run left a card saying "Thinking..." forever.
 *
 * Framing is delegated to `parseSSELines` (the one parser this codebase keeps —
 * it already exists for exactly the "two copies drifted" reason), so this file
 * only adds what a pull-loop needs that the push-parser does not:
 *
 *  - an INACTIVITY backstop. Every other surface sits behind use-sse-stream's
 *    120s timer; without one here, a wedged stream (machine sleep, TCP
 *    black-hole) left `isStreaming` true forever — and since scheduled prompts
 *    defer while busy, every later standing-order run queued behind a dead
 *    connection. The server sends heartbeat comments (~15s), so bytes arriving
 *    at all means the stream is alive; only genuine silence trips this.
 *
 * Policy-free by design: the caller decides what each event means. This
 * guarantees every well-formed `data:` line reaches `onEvent` exactly once,
 * whatever its type.
 */

/**
 * Thrown when no bytes arrive for `inactivityTimeoutMs`. Distinct from a clean
 * end-of-stream so the caller can tell "the server finished" from "the
 * connection died".
 */
export class StreamInactivityError extends Error {
  constructor(timeoutMs: number) {
    super(`No data received for ${timeoutMs / 1000}s — connection presumed dead.`);
    this.name = 'StreamInactivityError';
  }
}

export async function readTurnEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
  opts: { inactivityTimeoutMs?: number } = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDoneSentinel = false;

  // One timer, re-armed per read. The racing promise captures its reject so a
  // fire abandons the pending read() instead of waiting on a socket that may
  // never resolve.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectInactivity: ((e: Error) => void) | null = null;
  const arm = () => {
    if (timer) clearTimeout(timer);
    if (!opts.inactivityTimeoutMs) return;
    timer = setTimeout(() => {
      rejectInactivity?.(new StreamInactivityError(opts.inactivityTimeoutMs!));
    }, opts.inactivityTimeoutMs);
  };

  try {
    while (!sawDoneSentinel) {
      arm();
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          rejectInactivity = reject;
        }),
      ]);
      if (result.done) break;
      buffer = parseSSELines(
        buffer + decoder.decode(result.value, { stream: true }),
        onEvent as (event: unknown) => void,
        () => {
          sawDoneSentinel = true;
        },
      );
    }
  } finally {
    if (timer) clearTimeout(timer);
    // Release the connection if we are leaving early (timeout or sentinel).
    void reader.cancel().catch(() => {});
  }
}
