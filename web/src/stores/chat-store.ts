'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { surfaceTranscriptStorage } from '@/lib/transcripts/transcript-storage';
import { onStreamAborted } from '@/lib/stream-registry';
import { type SessionControls, DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';
import type { A2UIDocument } from '@/lib/a2ui/types';
import type { ModelOption } from '@/lib/models/client-options';
import type { TurnErrorCode } from '@/lib/sse/turn-error';
import { createTranscriptSlice, type TranscriptSlice } from '@/stores/slices/transcript-slice';

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
  /**
   * How much of the reply's text had arrived when this call was made — where it
   * sits in the reply. Absent on transcripts recorded before it existed, which
   * render their tool calls in one group above the text, as they always did.
   */
  textOffset?: number;
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
  /**
   * Where each API response's output starts in `content`, while the turn is
   * streaming: segment id → offset. What lets a response the SDK retracts (a
   * refused reply re-run on a fallback model) be cut back out by position. Only
   * meaningful mid-turn; cleared when the turn stops.
   */
  segmentMarks?: Record<string, number>;
}

export interface TurnError {
  code: TurnErrorCode;
  message: string;
}

// Shared by every store with this Message shape; they live with the slice now.
export { withTurnError, withRetryStatus } from '@/stores/slices/transcript-slice';

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

/** Chat's own state; the transcript half comes from `createTranscriptSlice`. */
interface ChatState {
  /**
   * The route selected in the model picker: either a tier (resolved through the
   * effective registry at send time) or a pinned model (built-in or on a
   * user-added provider). Null ⇒ use the built-in `model` enum. In-memory only
   * (the provider list itself persists in provider-store).
   */
  modelRoute: ModelOption | null;
  sessionControls: Record<string, SessionControls>;
  lastActivityAt: Record<string, number>;
  suggestions: Record<string, string[]>;
  canvasArtifacts: Record<string, CanvasArtifact[]>;
}

interface ChatActions {
  setModelRoute: (opt: ModelOption | null) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
  getSessionControls: (chatId: string) => SessionControls;
  touchActivity: (chatId: string) => void;
  addSuggestion: (chatId: string, suggestion: string) => void;
  clearSuggestions: (chatId: string) => void;
  addCanvasArtifact: (chatId: string, artifact: CanvasArtifact) => void;
  removeCanvasArtifact: (chatId: string, artifactId: string) => void;
}

export type ChatStore = TranscriptSlice & ChatState & ChatActions;

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      // Project detail starts a turn from outside the surface and relies on
      // startStreaming to land the surface on it.
      ...createTranscriptSlice(set, { selectOnStart: true, finishingToolsEndsReply: true }),
      modelRoute: null,
      sessionControls: {},
      lastActivityAt: {},
      suggestions: {},
      canvasArtifacts: {},

      setModelRoute: (opt) => set({ modelRoute: opt }),

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
      // Transcripts to IndexedDB per conversation, the rest to localStorage;
      // see lib/transcripts/transcript-storage.
      storage: surfaceTranscriptStorage('chat', (): Record<string, true> => useChatStore.getState().streamingChats),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        sessionControls: state.sessionControls,
        canvasArtifacts: state.canvasArtifacts,
      }),
      skipHydration: true,
      /*
       * v1: `verboseMode` now expands tool calls. Every persisted `true` is the
       * old default, which meant nothing — carrying it over would open every
       * tool card in those conversations. See DEFAULT_SESSION_CONTROLS.
       */
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as { sessionControls?: Record<string, SessionControls> };
        if (version < 1 && state?.sessionControls) {
          for (const ctrl of Object.values(state.sessionControls)) {
            if (ctrl) ctrl.verboseMode = false;
          }
        }
        return state as never;
      },
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
