/**
 * A reply as it happened: text, the tool calls it led into, the text after.
 *
 * Every tool call used to collapse into one bar above the whole reply, so
 * "Let me search for that…" appeared AFTER the searches it introduced. Each
 * call now carries `textOffset` — how much of the reply had arrived when it
 * was made — which is enough to put it back where it was.
 */

interface Placeable {
  id: string;
  textOffset?: number;
}

export type ReplySegment<T> =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; tools: T[] };

/**
 * Split `content` at each tool call's offset. Consecutive calls with no text
 * between them form one group; text that is only whitespace (the paragraph
 * break inserted when text resumes after a tool) is not a segment of its own.
 *
 * Returns null when there is nothing to interleave — no tool calls, or any call
 * without an offset (a transcript from before offsets were recorded) — and the
 * caller renders the reply the old way. Keys are stable while the reply
 * streams: a text segment is keyed by where it starts, a group by its first call.
 */
export function segmentReply<T extends Placeable>(content: string, toolCalls: readonly T[]): ReplySegment<T>[] | null {
  if (toolCalls.length === 0) return null;
  if (!toolCalls.every((tc) => typeof tc.textOffset === 'number')) return null;

  const segments: ReplySegment<T>[] = [];
  let cursor = 0;
  const pushText = (end: number) => {
    const text = content.slice(cursor, end);
    if (text.trim()) segments.push({ kind: 'text', key: `text-${cursor}`, text });
    cursor = end;
  };

  for (const tc of toolCalls) {
    // Clamped: offsets only move forward, and never past the text there is.
    const at = Math.min(Math.max(tc.textOffset as number, cursor), content.length);
    if (at > cursor) pushText(at);
    const last = segments.at(-1);
    if (last?.kind === 'tools') last.tools.push(tc);
    else segments.push({ kind: 'tools', key: `tools-${tc.id}`, tools: [tc] });
  }
  if (cursor < content.length) pushText(content.length);
  return segments;
}
