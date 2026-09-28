'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { createThrottledJSONStorage } from '@/lib/throttled-storage';
import { onStreamAborted } from '@/lib/stream-registry';
import { type SessionControls, DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';
import type { A2UIDocument } from '@/lib/a2ui/types';
import type { ModelOption } from '@/lib/models/client-options';
import type { TurnErrorCode } from '@/lib/sse/turn-error';

export type ModelId = 'sonnet' | 'opus' | 'haiku';
export type { SessionControls };

export interface CanvasArtifact {
  id: string;
  title: string;
  doc: A2UIDocument;
  createdAt: number;
}


export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'complete' | 'error';
  startTime: number;
  endTime?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: string;
  isStreaming?: boolean;
  isLoading?: boolean;
  attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' }>;
  /** AskUserQuestion data — present when the agent asks the user a question */
  questionData?: unknown;
  /** Links a question message to its AskUserQuestion tool call */
  questionToolUseId?: string;
  /** Whether the user has already answered this question */
  questionAnswered?: boolean;
  /** Agent-initiated connect request (P3.3) — the turn is paused on it */
  connectorRequest?: { connectorId: string; reason?: string; toolUseId: string };
  /** Whether this connect request has already been answered */
  connectorRequestSettled?: boolean;
  /** Auto-continue message injected by the system, not typed by the user */
  isAutoContinue?: boolean;
  /** Inline canvas chips — A2UI docs the agent rendered during this turn */
  inlineCanvases?: Array<{ id: string; title: string; doc: import('@/lib/a2ui/types').A2UIDocument }>;
  /**
   * The turn failed. Rendered as a banner beside the reply, never appended to
   * `content` — content goes back to the model as history, and "**Error:** …"
   * then read as something the assistant had said.
   */
  error?: TurnError;
  /** The provider is retrying; shown as a quiet status while the turn waits. */
  retrying?: { attempt: number; delayMs: number };
  /**
   * A slash command and its confirmation. Shown in the transcript, never sent
   * to the model: "/verbose" and "Verbose mode on" are not conversation.
   */
  isCommandEcho?: boolean;
}

export interface TurnError {
  code: TurnErrorCode;
  message: string;
}

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

/** Record a failed turn on its reply. Shared by every store with this Message shape. */
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

/** Clean stale streaming/loading flags from persisted messages (no active stream on rehydration). */
export function cleanStaleStreamingFlags(messages: Record<string, Message[]>): Record<string, Message[]> {
  let changed = false;
  const cleaned: Record<string, Message[]> = {};
  for (const [chatId, msgs] of Object.entries(messages)) {
    const fixedMsgs = msgs.map((m) => {
      if (m.isStreaming || m.isLoading) {
        changed = true;
        return { ...m, isStreaming: false, isLoading: false };
      }
      return m;
    });
    cleaned[chatId] = fixedMsgs;
  }
  return changed ? cleaned : messages;
}

/**
 * Drop messages that share an id with an earlier one in the same conversation.
 *
 * The store now refuses a duplicate id at write time, but conversations written
 * BEFORE that guard still hold them — and they render forever, because React
 * keys on the id: "Encountered two children with the same key,
 * `goal:r1:question:69dcd66df1a7b631`". Fixing the writer does nothing for data
 * already on disk, which is why the error count went UP rather than to zero: a
 * new duplicate stopped being added while five old ones kept rendering.
 *
 * The FIRST occurrence wins, matching `addMessage`, so what is already on screen
 * does not shift when the app reloads.
 */
export function dedupeMessageIds(
  messages: Record<string, Message[]>,
): Record<string, Message[]> {
  let changed = false;
  const cleaned: Record<string, Message[]> = {};
  for (const [chatId, msgs] of Object.entries(messages)) {
    const seen = new Set<string>();
    const kept = msgs.filter((m) => {
      if (seen.has(m.id)) {
        changed = true;
        return false;
      }
      seen.add(m.id);
      return true;
    });
    cleaned[chatId] = kept;
  }
  return changed ? cleaned : messages;
}

/**
 * Collapse repeated transcript rows the OLD minting left behind.
 *
 * Before #62, `use-goal-transcript` gave each line a `goal_<random>` id, so a
 * restart re-posted the whole transcript with fresh ids: one parked question,
 * four restarts, four identical "It needs a decision from you" rows. Those have
 * DISTINCT ids, so `dedupeMessageIds` cannot see them by construction — they
 * raise no React error, they are simply the clutter the user reported.
 *
 * NARROW ON PURPOSE. A content-based dedupe of chat messages in general would
 * be wrong: a user can legitimately say the same thing twice. This touches only
 * rows whose id the transcript hook minted (`goal_` then, `goal:` now), within
 * one conversation, keeping the first. Nothing else has ever used that prefix.
 */
export function dedupeLegacyTranscriptRows(
  messages: Record<string, Message[]>,
): Record<string, Message[]> {
  let changed = false;
  const cleaned: Record<string, Message[]> = {};
  for (const [chatId, msgs] of Object.entries(messages)) {
    /*
     * THE KEYED ROW WINS, not the first — measured, not assumed.
     *
     * Keep-first dropped the `goal:` row when a legacy `goal_` copy preceded
     * it, and the transcript hook immediately re-posted it: the question was
     * still parked, its keyed line was absent, and restoring exactly that is
     * the hook's job. Net result on disk was one legacy row plus one keyed row
     * with identical content — the line still painted twice.
     *
     * So: any legacy row whose content a keyed row already carries is dropped
     * first; then what remains is deduped by content keeping the first. The
     * keyed row is the durable identity going forward, and leaving it in place
     * means the hook has nothing to restore.
     */
    const keyedContent = new Set(
      msgs.filter((m) => m.id.startsWith('goal:')).map((m) => (m.content ?? '').trim()),
    );
    const seenContent = new Set<string>();
    cleaned[chatId] = msgs.filter((m) => {
      if (!/^goal[_:]/.test(m.id)) return true;
      const key = (m.content ?? '').trim();
      if (m.id.startsWith('goal_') && keyedContent.has(key)) {
        changed = true;
        return false;
      }
      if (seenContent.has(key)) {
        changed = true;
        return false;
      }
      seenContent.add(key);
      return true;
    });
  }
  return changed ? cleaned : messages;
}

interface ChatState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  /**
   * The route selected in the model picker: either a tier (resolved through the
   * effective registry at send time) or a pinned model (built-in or on a
   * user-added provider). Null ⇒ use the built-in `model` enum. In-memory only
   * (the provider list itself persists in provider-store).
   */
  modelRoute: ModelOption | null;
  /**
   * Any of this store's conversations mid-turn. Kept for callers that ask the
   * surface-wide question; the composer asks `streamingChats` instead.
   */
  isStreaming: boolean;
  /**
   * Which conversations have a turn in flight. Per chat, because one surface
   * boolean meant chat B showed a Stop that aborted nothing while A streamed,
   * and B could not send at all. Not persisted — no stream survives a reload.
   */
  streamingChats: Record<string, true>;
  sessionControls: Record<string, SessionControls>;
  lastActivityAt: Record<string, number>;
  suggestions: Record<string, string[]>;
  canvasArtifacts: Record<string, CanvasArtifact[]>;
}

interface ChatActions {
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  setTurnError: (chatId: string, error: TurnError) => void;
  setRetryStatus: (chatId: string, retrying: Message['retrying'] | null) => void;
  attachCanvasToLastAssistant: (chatId: string, canvas: { id: string; title: string; doc: import('@/lib/a2ui/types').A2UIDocument }) => void;
  setModelRoute: (opt: ModelOption | null) => void;
  startStreaming: (chatId: string) => void;
  stopStreaming: (chatId: string) => void;
  setCurrentChat: (chatId: string) => void;
  clearMessages: (chatId: string) => void;
  /**
   * Drop everything after `messageId` — or from it, with `inclusive`. How Retry
   * replaces a failed reply and Edit replaces a question, instead of stacking a
   * duplicate question and a second answer under the first.
   */
  truncateMessages: (chatId: string, messageId: string, opts?: { inclusive?: boolean }) => void;
  addToolCall: (chatId: string, toolCall: ToolCall) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  updateMessageContent: (chatId: string, messageId: string, content: string) => void;
  completeRunningTools: (chatId: string) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
  getSessionControls: (chatId: string) => SessionControls;
  touchActivity: (chatId: string) => void;
  setIsStreaming: (v: boolean) => void;
  setChatStreaming: (chatId: string, streaming: boolean) => void;
  addSuggestion: (chatId: string, suggestion: string) => void;
  clearSuggestions: (chatId: string) => void;
  addCanvasArtifact: (chatId: string, artifact: CanvasArtifact) => void;
  removeCanvasArtifact: (chatId: string, artifactId: string) => void;
}

export type ChatStore = ChatState & ChatActions;

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      modelRoute: null,
      isStreaming: false,
      streamingChats: {},
      sessionControls: {},
      lastActivityAt: {},
      suggestions: {},
      canvasArtifacts: {},

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

      appendToLastAssistant: (chatId, content, thinking) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last.role !== 'assistant') return state;
          const updated = [...msgs];
          updated[lastIdx] = {
            ...last,
            content: last.content + content,
            isLoading: false,
            // Output arriving means the retry it was waiting on succeeded.
            ...(last.retrying ? { retrying: undefined } : {}),
            ...(thinking ? { thinking: (last.thinking || '') + thinking } : {}),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

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
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last.role !== 'assistant') return state;
          const updated = [...msgs];
          updated[lastIdx] = {
            ...last,
            inlineCanvases: [...(last.inlineCanvases ?? []), canvas],
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      setModelRoute: (opt) => set({ modelRoute: opt }),

      startStreaming: (chatId) => set((state) => ({
        isStreaming: true,
        streamingChats: chatId ? { ...state.streamingChats, [chatId]: true } : state.streamingChats,
        // Project detail starts a turn from outside the surface and relies on
        // this to land the surface on it.
        currentChatId: chatId || state.currentChatId,
      })),

      stopStreaming: (chatId) =>
        set((state) => {
          const { [chatId]: _done, ...streamingChats } = state.streamingChats;
          // Only this chat's turn ended; another conversation may still be
          // running, and the surface-wide flag must say so.
          const isStreaming = Object.keys(streamingChats).length > 0;
          const msgs = state.messages[chatId];
          if (!msgs?.length) return { isStreaming, streamingChats };
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          const updated = [...msgs];
          updated[lastIdx] = { ...last, isStreaming: false, isLoading: false, retrying: undefined };
          return { isStreaming, streamingChats, messages: { ...state.messages, [chatId]: updated } };
        }),

      setCurrentChat: (chatId) => set({ currentChatId: chatId }),

      clearMessages: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.messages;
          return { messages: rest };
        }),

      truncateMessages: (chatId, messageId, opts) =>
        set((state) => {
          const msgs = state.messages[chatId];
          const idx = msgs?.findIndex((m) => m.id === messageId) ?? -1;
          if (!msgs || idx < 0) return state;
          return {
            messages: { ...state.messages, [chatId]: msgs.slice(0, opts?.inclusive ? idx : idx + 1) },
          };
        }),

      addToolCall: (chatId, toolCall) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last.role !== 'assistant') return state;
          const updated = [...msgs];
          updated[lastIdx] = {
            ...last,
            toolCalls: [...(last.toolCalls ?? []), toolCall],
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      updateToolResult: (chatId, toolCallId, output, isError) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last.role !== 'assistant' || !last.toolCalls) return state;
          const updated = [...msgs];
          updated[lastIdx] = {
            ...last,
            toolCalls: last.toolCalls.map((tc) =>
              tc.id === toolCallId
                ? { ...tc, output, status: (isError ? 'error' : 'complete') as ToolCall['status'], endTime: Date.now() }
                : tc
            ),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      updateMessageContent: (chatId, messageId, content) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const updated = msgs.map((m) => m.id === messageId ? { ...m, content } : m);
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      completeRunningTools: (chatId) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last.role !== 'assistant' || !last.toolCalls) return state;
          const hasRunning = last.toolCalls.some((tc) => tc.status === 'running');
          if (!hasRunning) return state;
          const updated = [...msgs];
          updated[lastIdx] = {
            ...last,
            isLoading: false,
            isStreaming: false,
            toolCalls: last.toolCalls.map((tc) =>
              tc.status === 'running'
                ? { ...tc, status: 'complete' as const, endTime: Date.now() }
                : tc
            ),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      setSessionControls: (chatId, controls) =>
        set((state) => ({
          sessionControls: { ...state.sessionControls, [chatId]: controls },
        })),

      getSessionControls: (_chatId) => {
        return DEFAULT_SESSION_CONTROLS;
      },

      touchActivity: (chatId) =>
        set((state) => ({
          lastActivityAt: { ...state.lastActivityAt, [chatId]: Date.now() },
        })),

      setIsStreaming: (v) => set({ isStreaming: v }),

      setChatStreaming: (chatId, streaming) =>
        set((state) => {
          if (!chatId || !!state.streamingChats[chatId] === streaming) return state;
          const next = { ...state.streamingChats };
          if (streaming) next[chatId] = true;
          else delete next[chatId];
          return { streamingChats: next };
        }),

      addSuggestion: (chatId, suggestion) =>
        set((state) => ({
          suggestions: {
            ...state.suggestions,
            [chatId]: [...(state.suggestions[chatId] || []), suggestion].slice(-3),
          },
        })),

      clearSuggestions: (chatId) =>
        set((state) => ({
          suggestions: { ...state.suggestions, [chatId]: [] },
        })),

      addCanvasArtifact: (chatId, artifact) =>
        set((state) => ({
          canvasArtifacts: {
            ...state.canvasArtifacts,
            [chatId]: [...(state.canvasArtifacts[chatId] ?? []), artifact],
          },
        })),

      removeCanvasArtifact: (chatId, artifactId) =>
        set((state) => ({
          canvasArtifacts: {
            ...state.canvasArtifacts,
            [chatId]: (state.canvasArtifacts[chatId] ?? []).filter((c) => c.id !== artifactId),
          },
        })),
    }),
    {
      name: 'aime:chat',
      // Not per token: see lib/throttled-storage. Busy = any chat mid-turn.
      storage: createThrottledJSONStorage(() => getGatedStorage(), {
        isBusy: (): boolean => Object.keys(useChatStore.getState().streamingChats).length > 0,
      }),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        sessionControls: state.sessionControls,
        canvasArtifacts: state.canvasArtifacts,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.messages = dedupeLegacyTranscriptRows(dedupeMessageIds(cleanStaleStreamingFlags(state.messages)));
          // Migrate persisted sessionControls to include effortLevel (added in v1.2.0)
          if (state.sessionControls) {
            for (const chatId of Object.keys(state.sessionControls)) {
              const ctrl = state.sessionControls[chatId];
              if (ctrl && !('effortLevel' in ctrl)) {
                (ctrl as Record<string, unknown>).effortLevel = null;
              }
            }
          }
        }
      },
    }
  )
);

/**
 * Finalise a turn whose stream was aborted.
 *
 * A Stop, a conversation switch, a stuck-tool cancel and the SSE inactivity
 * timeout all abort the fetch, so the surface's onDone/onError never run — and
 * those are the only callers of `stopStreaming`, the only thing that clears the
 * per-message `isStreaming`/`isLoading` flags that render the spinner. (The
 * store-level `isStreaming` boolean does not: it gates the composer.) Wiring it
 * here makes it true for every abort call site instead of none of them.
 */
onStreamAborted(({ chatId }) => {
  const state = useChatStore.getState();
  // chatIds are conversation ids, so a stream that belongs to another surface's
  // store has no messages here — and its flags are not ours to touch.
  if (!state.messages[chatId]?.length) return;
  state.completeRunningTools(chatId);
  state.stopStreaming(chatId);
});
