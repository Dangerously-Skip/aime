import { describe, it, expect } from 'vitest';
import { createSSEStream } from './sse';

async function readAll(readable: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe('createSSEStream', () => {
  it('serializes object events as SSE data frames', async () => {
    const sse = createSSEStream();
    const consumed = readAll(sse.readable);

    await sse.writeEvent({ type: 'connected', ok: true });
    await sse.close();

    expect(await consumed).toBe('data: {"type":"connected","ok":true}\n\n');
  });

  it('passes string events through without re-serializing', async () => {
    const sse = createSSEStream();
    const consumed = readAll(sse.readable);

    await sse.writeEvent('raw payload');
    await sse.close();

    expect(await consumed).toBe('data: raw payload\n\n');
  });

  it('writes heartbeats as SSE comments', async () => {
    const sse = createSSEStream();
    const consumed = readAll(sse.readable);

    await sse.writeHeartbeat();
    await sse.writeEvent({ n: 1 });
    await sse.close();

    expect(await consumed).toBe(': heartbeat\n\ndata: {"n":1}\n\n');
  });

  it('preserves event order across multiple writes', async () => {
    const sse = createSSEStream();
    const consumed = readAll(sse.readable);

    for (let i = 0; i < 5; i++) await sse.writeEvent({ i });
    await sse.close();

    const frames = (await consumed).trim().split('\n\n');
    expect(frames).toHaveLength(5);
    frames.forEach((frame, i) => expect(frame).toBe(`data: {"i":${i}}`));
  });

  it('does not throw when writing after close', async () => {
    const sse = createSSEStream();
    const consumed = readAll(sse.readable);
    await sse.close();

    await expect(sse.writeEvent({ late: true })).resolves.toBeUndefined();
    await expect(sse.writeHeartbeat()).resolves.toBeUndefined();
    await expect(sse.close()).resolves.toBeUndefined();

    expect(await consumed).toBe('');
  });

  it('produces a Response with SSE headers and merges extras', () => {
    const sse = createSSEStream();
    const res = sse.toResponse({ 'X-Custom': 'yes' });

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    expect(res.headers.get('X-Custom')).toBe('yes');
  });

  it('streams written events through the Response body', async () => {
    const sse = createSSEStream();
    const res = sse.toResponse();

    // The Response body is the readable side of the same TransformStream;
    // a consumer must be pulling before writes resolve (writes apply
    // backpressure until the client reads — as with a real SSE connection).
    const consumed = readAll(res.body!);
    await sse.writeEvent({ via: 'response' });
    await sse.close();

    expect(await consumed).toBe('data: {"via":"response"}\n\n');
  });
});
