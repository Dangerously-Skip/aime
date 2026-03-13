/**
 * SSE (Server-Sent Events) streaming helper for Next.js API routes.
 *
 * Uses TransformStream to create a streaming response compatible with
 * the Web Streams API used by Next.js App Router route handlers.
 */

export interface SSEStream {
  /** The writable side of the TransformStream. */
  writable: WritableStream<Uint8Array>;
  /** The readable side of the TransformStream (pass to Response constructor). */
  readable: ReadableStream<Uint8Array>;
  /** The writer for sending data. */
  writer: WritableStreamDefaultWriter<Uint8Array>;
  /** TextEncoder instance for encoding strings to Uint8Array. */
  encoder: TextEncoder;
  /** Write an SSE data event (auto-serializes objects to JSON). */
  writeEvent: (data: unknown) => Promise<void>;
  /** Write an SSE heartbeat comment to keep the connection alive. */
  writeHeartbeat: () => Promise<void>;
  /** Close the stream. */
  close: () => Promise<void>;
  /** Create a Response object with proper SSE headers. */
  toResponse: (extraHeaders?: Record<string, string>) => Response;
}

/**
 * Create an SSE stream with helpers for writing events.
 *
 * Usage in a Next.js route handler:
 * ```ts
 * export async function POST(req: Request) {
 *   const sse = createSSEStream();
 *
 *   // Start streaming in the background
 *   (async () => {
 *     await sse.writeEvent({ type: 'connected' });
 *     // ... stream data ...
 *     await sse.close();
 *   })();
 *
 *   return sse.toResponse();
 * }
 * ```
 */
export function createSSEStream(): SSEStream {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const writeEvent = async (data: unknown): Promise<void> => {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    try {
      await writer.write(encoder.encode(`data: ${serialized}\n\n`));
    } catch {
      // Stream may have been closed by the client
    }
  };

  const writeHeartbeat = async (): Promise<void> => {
    try {
      await writer.write(encoder.encode(': heartbeat\n\n'));
    } catch {
      // Stream may have been closed by the client
    }
  };

  const close = async (): Promise<void> => {
    try {
      await writer.close();
    } catch {
      // Already closed
    }
  };

  const toResponse = (extraHeaders: Record<string, string> = {}): Response => {
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...extraHeaders,
      },
    });
  };

  return {
    writable,
    readable,
    writer,
    encoder,
    writeEvent,
    writeHeartbeat,
    close,
    toResponse,
  };
}
