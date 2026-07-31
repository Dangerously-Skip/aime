import type { ToolCall } from '@/stores/chat-store';

/**
 * Attaching tool calls and their results to the last assistant message.
 *
 * ## Why these are shared
 *
 * `browser-store` and `code-store` carried byte-identical copies of both — 32
 * lines, not similar but the same characters. Each encodes the same four
 * non-obvious decisions, and a fix to one copy would silently not reach the
 * other:
 *
 *   1. Tool calls attach to the LAST message, and only if it is the assistant's.
 *      A tool call arriving after the user has typed again belongs to nothing.
 *   2. A mismatch is a no-op, never a throw. These run inside a streaming
 *      handler where an exception loses the rest of the turn.
 *   3. Updates are immutable all the way down — a new array, a new message, a new
 *      map — because zustand identity is what drives React re-renders. Mutating
 *      in place leaves the UI stale.
 *   4. `endTime` is stamped on the result, which is what the duration in the UI
 *      is computed from.
 *
 * Pure and store-agnostic: they take the message map and return a new one, so a
 * store's `set` decides what to do with it and neither store has to know about
 * the other. Returning `null` for "nothing changed" lets the caller return its
 * own `state` unchanged, which is zustand's signal to skip the notification.
 */

/** The shape these need; both stores' message types satisfy it structurally. */
interface WithToolCalls {
  role: string;
  toolCalls?: ToolCall[];
}

/**
 * Append a tool call to the last assistant message.
 *
 * @returns A new message map, or `null` when there is nothing to attach to.
 */
export function withToolCall<M extends WithToolCalls>(
  messages: Record<string, M[]>,
  chatId: string,
  toolCall: ToolCall,
): Record<string, M[]> | null {
  const msgs = messages[chatId];
  if (!msgs?.length) return null;
  const lastIdx = msgs.length - 1;
  const last = msgs[lastIdx];
  if (last.role !== 'assistant') return null;

  const updated = [...msgs];
  updated[lastIdx] = { ...last, toolCalls: [...(last.toolCalls ?? []), toolCall] };
  return { ...messages, [chatId]: updated };
}

/**
 * Record the result of a tool call on the last assistant message.
 *
 * @returns A new message map, or `null` when there is no matching message.
 */
export function withToolResult<M extends WithToolCalls>(
  messages: Record<string, M[]>,
  chatId: string,
  toolCallId: string,
  output: string,
  isError: boolean | undefined,
  now: number,
): Record<string, M[]> | null {
  const msgs = messages[chatId];
  if (!msgs?.length) return null;
  const lastIdx = msgs.length - 1;
  const last = msgs[lastIdx];
  if (last.role !== 'assistant' || !last.toolCalls) return null;

  const updated = [...msgs];
  updated[lastIdx] = {
    ...last,
    toolCalls: last.toolCalls.map((tc) =>
      tc.id === toolCallId
        ? {
            ...tc,
            output,
            status: (isError ? 'error' : 'complete') as ToolCall['status'],
            endTime: now,
          }
        : tc,
    ),
  };
  return { ...messages, [chatId]: updated };
}
