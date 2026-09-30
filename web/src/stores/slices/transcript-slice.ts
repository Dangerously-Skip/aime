import type { A2UIDocument } from '@/lib/a2ui/types';
import { withToolCall, withToolResult } from '@/lib/stores/tool-call-reducers';
// Type-only: erased at runtime, so chat-store importing this file is not a cycle.
import type { Message, ToolCall, TurnError } from '@/stores/chat-store';

/**
 * The transcript half of every conversation store, written once.
 *
 * Chat, Cowork, Code and Browser each carried their own copy of the same dozen
 * actions. They had already drifted in the way copies do: the per-chat
 * streaming fix, `setTurnError` and the retry status landed in Chat and Cowork
 * and never reached the other two, so a Code turn that failed still wrote
 * "**Error:** …" into the reply the model reads back as history. One slice
 * means a fix lands on every surface or on none.
 *
 * What stays in each store is what is genuinely that surface's: folders, plan,
 * tabs, canvas artifacts, the model route. The two behaviours that differ are
 * options below rather than forks.
 */

export interface TranscriptState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  /**
   * Any of this store's conversations mid-turn. Kept for callers that ask the
   * surface-wide question; the composer asks `streamingChats` instead.
   */
  isStreaming: boolean;
  /**
   * Which conversations have a turn in flight. Per chat, because one surface
   * boolean meant chat B showed a Stop that aborted nothing while A streamed,
   * and B could not send at all. Not persisted — no stream survives a reload.
   * Transcript persistence also reads it: a conversation mid-turn is not
   * written until the turn ends (see lib/transcripts/transcript-storage).
   */
  streamingChats: Record<string, true>;
}

export type InlineCanvas = { id: string; title: string; doc: A2UIDocument };

export interface TranscriptActions {
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  updateMessageContent: (chatId: string, messageId: string, content: string) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  setTurnError: (chatId: string, error: TurnError) => void;
  setRetryStatus: (chatId: string, retrying: Message['retrying'] | null) => void;
  attachCanvasToLastAssistant: (chatId: string, canvas: InlineCanvas) => void;
  startStreaming: (chatId: string) => void;
  stopStreaming: (chatId: string) => void;
  setIsStreaming: (v: boolean) => void;
  setChatStreaming: (chatId: string, streaming: boolean) => void;
  setCurrentChat: (chatId: string | null) => void;
  clearMessages: (chatId: string) => void;
  /**
   * Drop everything after `messageId` — or from it, with `inclusive`. How Retry
   * replaces a failed reply and Edit replaces a question, instead of stacking a
   * duplicate question and a second answer under the first.
   */
  truncateMessages: (chatId: string, messageId: string, opts?: { inclusive?: boolean }) => void;
  addToolCall: (chatId: string, toolCall: ToolCall) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  completeRunningTools: (chatId: string) => void;
}

export type TranscriptSlice = TranscriptState & TranscriptActions;

export interface TranscriptSliceOptions {
  /**
   * Starting a turn also puts its conversation on screen. Chat relies on this:
   * project detail starts a turn from outside the surface. Cowork must not —
   * an auto-continue in chat A yanked a user who had moved on to B back to A.
   */
  selectOnStart?: boolean;
  /** Runs before the streaming flags are set (Cowork stamps the turn start). */
  onStart?: (chatId: string) => void;
  /**
   * `completeRunningTools` also clears the reply's loading/streaming flags.
   * Chat and Browser have always done this; Cowork and Code have not, because
   * there the reply keeps streaming after a tool finishes and the flags are
   * cleared by `stopStreaming`. Kept as it was rather than guessed at.
   */
  finishingToolsEndsReply?: boolean;
}

type SetTranscript = (
  fn: (state: TranscriptSlice) => TranscriptSlice | Partial<TranscriptSlice>,
) => void;

/**
 * Where a turn's error / retry status lands: the last assistant message, which
 * is the reply the turn was writing. A question or connect card can sit after
 * it, which is why this is not simply "the last message".
 */
function lastAssistantIndex(msgs: Message[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && !msgs[i].questionData && !msgs[i].connectorRequest) return i;
    if (msgs[i].role === 'user') return -1;
  }
  return -1;
}

/** Record a failed turn on its reply. */
export function withTurnError(msgs: Message[], error: TurnError): Message[] | null {
  const idx = lastAssistantIndex(msgs);
  if (idx < 0) return null;
  const updated = [...msgs];
  updated[idx] = { ...updated[idx], error, retrying: undefined, isLoading: false, isStreaming: false };
  return updated;
}

export function withRetryStatus(msgs: Message[], retrying: Message['retrying'] | null): Message[] | null {
  const idx = lastAssistantIndex(msgs);
  if (idx < 0) return null;
  const updated = [...msgs];
  updated[idx] = { ...updated[idx], retrying: retrying ?? undefined };
  return updated;
}

/**
 * Replace the last message when it is the assistant's; `null` otherwise, which
 * the caller turns into "return state" — zustand's signal that nothing changed.
 */
function withLastAssistant(
  messages: Record<string, Message[]>,
  chatId: string,
  change: (last: Message) => Message | null,
): Record<string, Message[]> | null {
  const msgs = messages[chatId];
  if (!msgs?.length) return null;
  const lastIdx = msgs.length - 1;
  const last = msgs[lastIdx];
  if (last.role !== 'assistant') return null;
  const next = change(last);
  if (!next) return null;
  const updated = [...msgs];
  updated[lastIdx] = next;
  return { ...messages, [chatId]: updated };
}

export function createTranscriptSlice(set: SetTranscript, opts: TranscriptSliceOptions = {}): TranscriptSlice {
  /** A new message map, or the untouched state when a reducer had nothing to change. */
  const apply = (state: TranscriptSlice, next: Record<string, Message[]> | null) =>
    next ? { messages: next } : state;

  return {
    messages: {},
    currentChatId: null,
    isStreaming: false,
    streamingChats: {},

    /*
     * IDEMPOTENT BY ID, and the check has to happen INSIDE `set`.
     *
     * `updateMessage` exists for changing a message, so adding one whose id
     * is already present is always a bug — and it produced a real one: React
     * "Encountered two children with the same key, goal:r1:question:…".
     *
     * The goal transcript posts lines with ids derived from their content so
     * a restart cannot re-narrate a run. It checked the store first, but a
     * read-then-write from a caller is not atomic: two polls in flight at
     * once — or the Cowork and Code surfaces both mounted, which this app
     * does deliberately — can each read "not present" and both append.
     *
     * Doing it here closes that for every caller rather than asking each one
     * to remember, which is the same trade the local-API cookie makes.
     */
    addMessage: (chatId, message) =>
      set((state) => {
        const existing = state.messages[chatId] ?? [];
        if (existing.some((m) => m.id === message.id)) return state;
        return {
          messages: { ...state.messages, [chatId]: [...existing, message] },
        };
      }),

    updateMessage: (chatId, messageId, updates) =>
      set((state) => {
        const msgs = state.messages[chatId];
        if (!msgs) return state;
        return {
          messages: {
            ...state.messages,
            [chatId]: msgs.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
          },
        };
      }),

    updateMessageContent: (chatId, messageId, content) =>
      set((state) => {
        const msgs = state.messages[chatId];
        if (!msgs?.length) return state;
        return {
          messages: { ...state.messages, [chatId]: msgs.map((m) => (m.id === messageId ? { ...m, content } : m)) },
        };
      }),

    appendToLastAssistant: (chatId, content, thinking) =>
      set((state) =>
        apply(
          state,
          withLastAssistant(state.messages, chatId, (last) => ({
            ...last,
            content: last.content + content,
            isLoading: false,
            // Output arriving means the retry it was waiting on succeeded.
            ...(last.retrying ? { retrying: undefined } : {}),
            ...(thinking ? { thinking: (last.thinking || '') + thinking } : {}),
          })),
        ),
      ),

    setTurnError: (chatId, error) =>
      set((state) => {
        const updated = withTurnError(state.messages[chatId] ?? [], error);
        return updated ? { messages: { ...state.messages, [chatId]: updated } } : state;
      }),

    setRetryStatus: (chatId, retrying) =>
      set((state) => {
        const updated = withRetryStatus(state.messages[chatId] ?? [], retrying);
        return updated ? { messages: { ...state.messages, [chatId]: updated } } : state;
      }),

    attachCanvasToLastAssistant: (chatId, canvas) =>
      set((state) =>
        apply(
          state,
          withLastAssistant(state.messages, chatId, (last) => ({
            ...last,
            inlineCanvases: [...(last.inlineCanvases ?? []), canvas],
          })),
        ),
      ),

    startStreaming: (chatId) => {
      if (chatId) opts.onStart?.(chatId);
      set((state) => ({
        isStreaming: true,
        streamingChats: chatId ? { ...state.streamingChats, [chatId]: true } : state.streamingChats,
        ...(opts.selectOnStart ? { currentChatId: chatId || state.currentChatId } : {}),
      }));
    },

    stopStreaming: (chatId) =>
      set((state) => {
        const { [chatId]: _done, ...streamingChats } = state.streamingChats;
        // Only this chat's turn ended; another conversation may still be
        // running, and the surface-wide flag must say so.
        const isStreaming = Object.keys(streamingChats).length > 0;
        const msgs = state.messages[chatId];
        if (!msgs?.length) return { isStreaming, streamingChats };
        const lastIdx = msgs.length - 1;
        const updated = [...msgs];
        updated[lastIdx] = { ...msgs[lastIdx], isStreaming: false, isLoading: false, retrying: undefined };
        return { isStreaming, streamingChats, messages: { ...state.messages, [chatId]: updated } };
      }),

    setIsStreaming: (v) => set(() => ({ isStreaming: v })),

    setChatStreaming: (chatId, streaming) =>
      set((state) => {
        if (!chatId || !!state.streamingChats[chatId] === streaming) return state;
        const next = { ...state.streamingChats };
        if (streaming) next[chatId] = true;
        else delete next[chatId];
        return { streamingChats: next };
      }),

    setCurrentChat: (chatId) => set(() => ({ currentChatId: chatId })),

    clearMessages: (chatId) =>
      set((state) => {
        const { [chatId]: _, ...rest } = state.messages;
        return { messages: rest };
      }),

    truncateMessages: (chatId, messageId, truncateOpts) =>
      set((state) => {
        const msgs = state.messages[chatId];
        const idx = msgs?.findIndex((m) => m.id === messageId) ?? -1;
        if (!msgs || idx < 0) return state;
        return {
          messages: { ...state.messages, [chatId]: msgs.slice(0, truncateOpts?.inclusive ? idx : idx + 1) },
        };
      }),

    addToolCall: (chatId, toolCall) => set((state) => apply(state, withToolCall(state.messages, chatId, toolCall))),

    updateToolResult: (chatId, toolCallId, output, isError) =>
      set((state) => apply(state, withToolResult(state.messages, chatId, toolCallId, output, isError, Date.now()))),

    completeRunningTools: (chatId) =>
      set((state) =>
        apply(
          state,
          withLastAssistant(state.messages, chatId, (last) => {
            // No-op when nothing is running, so a stream of text events does
            // not rewrite the message array on every chunk.
            if (!last.toolCalls?.some((tc) => tc.status === 'running')) return null;
            return {
              ...last,
              ...(opts.finishingToolsEndsReply ? { isLoading: false, isStreaming: false } : {}),
              toolCalls: last.toolCalls.map((tc) =>
                tc.status === 'running' ? { ...tc, status: 'complete' as const, endTime: Date.now() } : tc,
              ),
            };
          }),
        ),
      ),
  };
}
