/**
 * Parse a chunk of an SSE body into events, returning the incomplete tail.
 *
 * ## Why this is one function now
 *
 * There were two, and the second admitted it in its own header: `// SSE parsing
 * (mirrors use-sse-stream.ts logic)`. They were identical across ~25 lines —
 * same split, same last-line-without-newline handling, same comment/blank skip,
 * same `data:` slice, same `[DONE]` short-circuit, same swallow-on-unparseable —
 * differing only in whether `[DONE]` invoked a callback on the way out.
 *
 * That is the shape worth removing: not "similar code", but a byte-for-byte copy
 * of a parser whose edge cases are the entire point. The tail handling in
 * particular is what makes chunked delivery work at all, and a bug fixed in one
 * copy would silently not reach the other — the browser surface and the main
 * chat stream would drift apart on the same wire format.
 *
 * Generic over the event type on purpose: the two callers have different event
 * unions (`use-sse-stream`'s exported `SSEEvent` and the browser agent's local
 * one) and neither should have to widen to the other's. Parsing the frame and
 * knowing what is inside it are separate jobs.
 */

/**
 * @param buffer   Everything received and not yet consumed.
 * @param onEvent  Called once per complete `data:` line that parses as JSON.
 * @param onDone   Called when the terminal `[DONE]` sentinel is seen. Optional —
 *                 a caller that ends on stream close rather than on the sentinel
 *                 does not need it.
 * @returns The trailing partial line to prepend to the next chunk. Empty after
 *          `[DONE]`, since nothing after the sentinel is ours to interpret.
 */
export function parseSSELines<T>(
  buffer: string,
  onEvent: (event: T) => void,
  onDone?: () => void,
): string {
  const lines = buffer.split('\n');
  let remaining = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A final line with no trailing newline is incomplete: hand it back rather
    // than parsing half an event. This is the whole reason the function returns
    // a string, and the bug that appears first if it is dropped.
    if (i === lines.length - 1 && !buffer.endsWith('\n')) {
      remaining = line;
      continue;
    }

    const trimmed = line.trim();
    // Blank lines separate events; `:` is an SSE comment (used for heartbeats).
    if (trimmed === '' || trimmed.startsWith(':')) continue;

    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        onDone?.();
        return '';
      }
      try {
        onEvent(JSON.parse(payload) as T);
      } catch {
        // A malformed line must not kill the stream — the next event may be
        // fine, and dropping one frame beats dropping the rest of the turn.
      }
    }
  }

  return remaining;
}
