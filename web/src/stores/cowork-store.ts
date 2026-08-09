'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { onStreamAborted } from '@/lib/stream-registry';
import {
  findUnregisteredArtifacts,
  markTurnStart,
  turnStartedAt,
} from '@/lib/artifact-reconcile';
import type { Message, ToolCall, ModelId } from '@/stores/chat-store';
import { cleanStaleStreamingFlags } from '@/stores/chat-store';
import { type SessionControls } from '@/lib/slash-commands';
import type { A2UIDocument } from '@/lib/a2ui/types';
import type { ModelOption } from '@/lib/models/client-options';

export interface CanvasArtifact {
  id: string;
  title: string;
  doc: A2UIDocument;
  /** Optional templateId so the sidebar can show a more specific icon. */
  templateId?: string;
  createdAt: number;
}

const VALID_MODELS: Set<string> = new Set<string>(['sonnet', 'opus', 'haiku']);

interface CoworkState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  /**
   * Selected route — a tier or a pinned model (in-memory); null ⇒ use the
   * built-in `model` enum.
   */
  modelRoute: ModelOption | null;
  isStreaming: boolean;
  folderByChat: Record<string, string | null>;
  contextFiles: Record<string, string[]>;
  artifactFiles: Record<string, string[]>;
  canvasArtifacts: Record<string, CanvasArtifact[]>;
  planContent: Record<string, string>;
  planOpen: boolean;
  sessionControls: Record<string, SessionControls>;
  lastActivityAt: Record<string, number>;
  searchGroups: Record<string, { query: string; results: { title: string; url: string; snippet: string }[] }[]>;
}

interface CoworkActions {
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  attachCanvasToLastAssistant: (chatId: string, canvas: { id: string; title: string; doc: A2UIDocument }) => void;
  setModelRoute: (opt: ModelOption | null) => void;
  startStreaming: (chatId: string) => void;
  stopStreaming: (chatId: string) => void;
  setCurrentChat: (chatId: string | null) => void;
  clearMessages: (chatId: string) => void;
  addToolCall: (chatId: string, toolCall: ToolCall) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  completeRunningTools: (chatId: string) => void;
  setFolder: (chatId: string, folder: string | null) => void;
  addContextFile: (chatId: string, path: string) => void;
  addArtifactFile: (chatId: string, path: string) => void;
  removeContextFile: (chatId: string, path: string) => void;
  removeArtifactFile: (chatId: string, path: string) => void;
  addCanvasArtifact: (chatId: string, artifact: CanvasArtifact) => void;
  removeCanvasArtifact: (chatId: string, artifactId: string) => void;
  clearSidebarFiles: (chatId: string) => void;
  setPlanContent: (chatId: string, content: string) => void;
  setPlanOpen: (open: boolean) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
  touchActivity: (chatId: string) => void;
  setIsStreaming: (v: boolean) => void;
  addSearchGroup: (chatId: string, group: { query: string; results: { title: string; url: string; snippet: string }[] }) => void;
  clearSearchGroups: (chatId: string) => void;
}

export type CoworkStore = CoworkState & CoworkActions;

export const useCoworkStore = create<CoworkStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      modelRoute: null,
      isStreaming: false,
      folderByChat: {},
      contextFiles: {},
      artifactFiles: {},
      canvasArtifacts: {},
      planContent: {},
      planOpen: false,
      sessionControls: {},
      lastActivityAt: {},
      searchGroups: {},

      addMessage: (chatId, message) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [chatId]: [...(state.messages[chatId] ?? []), message],
          },
        })),

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
            ...(thinking ? { thinking: (last.thinking || '') + thinking } : {}),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
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

      startStreaming: (chatId) => {
        // Stamped here so an aborted turn can tell its own files from every
        // previous turn's when it reconciles the scratch directory.
        if (chatId) markTurnStart(chatId);
        set((state) => ({
          isStreaming: true,
          currentChatId: chatId || state.currentChatId,
        }));
      },

      stopStreaming: (chatId) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return { isStreaming: false };
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          const updated = [...msgs];
          updated[lastIdx] = { ...last, isStreaming: false, isLoading: false };
          return { isStreaming: false, messages: { ...state.messages, [chatId]: updated } };
        }),

      setCurrentChat: (chatId) => set({ currentChatId: chatId }),

      clearMessages: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.messages;
          return { messages: rest };
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
            toolCalls: last.toolCalls.map((tc) =>
              tc.status === 'running'
                ? { ...tc, status: 'complete' as const, endTime: Date.now() }
                : tc
            ),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      setFolder: (chatId, folder) => set((state) => ({
        folderByChat: { ...state.folderByChat, [chatId]: folder },
      })),

      addContextFile: (chatId, path) =>
        set((state) => {
          const existing = state.contextFiles[chatId] ?? [];
          if (existing.includes(path)) return state;
          return { contextFiles: { ...state.contextFiles, [chatId]: [...existing, path] } };
        }),

      addArtifactFile: (chatId, path) =>
        set((state) => {
          const existing = state.artifactFiles[chatId] ?? [];
          if (existing.includes(path)) return state;
          return { artifactFiles: { ...state.artifactFiles, [chatId]: [...existing, path] } };
        }),

      removeContextFile: (chatId, path) =>
        set((state) => {
          const existing = state.contextFiles[chatId] ?? [];
          return { contextFiles: { ...state.contextFiles, [chatId]: existing.filter((p) => p !== path) } };
        }),

      removeArtifactFile: (chatId, path) =>
        set((state) => {
          const existing = state.artifactFiles[chatId] ?? [];
          return { artifactFiles: { ...state.artifactFiles, [chatId]: existing.filter((p) => p !== path) } };
        }),

      addCanvasArtifact: (chatId, artifact) =>
        set((state) => {
          const existing = state.canvasArtifacts[chatId] ?? [];
          return { canvasArtifacts: { ...state.canvasArtifacts, [chatId]: [...existing, artifact] } };
        }),

      removeCanvasArtifact: (chatId, artifactId) =>
        set((state) => {
          const existing = state.canvasArtifacts[chatId] ?? [];
          return { canvasArtifacts: { ...state.canvasArtifacts, [chatId]: existing.filter((c) => c.id !== artifactId) } };
        }),

      clearSidebarFiles: (chatId) =>
        set((state) => {
          const { [chatId]: _ctx, ...restCtx } = state.contextFiles;
          const { [chatId]: _art, ...restArt } = state.artifactFiles;
          const { [chatId]: _canvas, ...restCanvas } = state.canvasArtifacts;
          return { contextFiles: restCtx, artifactFiles: restArt, canvasArtifacts: restCanvas };
        }),

      setPlanContent: (chatId, content) =>
        set((state) => ({
          planContent: { ...state.planContent, [chatId]: content },
        })),

      setPlanOpen: (open) => set({ planOpen: open }),

      setSessionControls: (chatId, controls) =>
        set((state) => ({
          sessionControls: { ...state.sessionControls, [chatId]: controls },
        })),

      touchActivity: (chatId) =>
        set((state) => ({
          lastActivityAt: { ...state.lastActivityAt, [chatId]: Date.now() },
        })),

      setIsStreaming: (v) => set({ isStreaming: v }),
      addSearchGroup: (chatId, group) =>
        set((state) => ({
          searchGroups: {
            ...state.searchGroups,
            [chatId]: [...(state.searchGroups[chatId] ?? []), group],
          },
        })),
      clearSearchGroups: (chatId) =>
        set((state) => ({
          searchGroups: { ...state.searchGroups, [chatId]: [] },
        })),
    }),
    {
      name: 'aime:cowork',
      storage: createJSONStorage(() => getGatedStorage()),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        folderByChat: state.folderByChat,
        contextFiles: state.contextFiles,
        artifactFiles: state.artifactFiles,
        canvasArtifacts: state.canvasArtifacts,
        planContent: state.planContent,
        sessionControls: state.sessionControls,
        searchGroups: state.searchGroups,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.messages = cleanStaleStreamingFlags(state.messages);
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
 * Finalise a turn whose stream was aborted — see the matching subscription in
 * chat-store. Cowork reaches it from the Stop button, the conversation-switch
 * abort, and its own 120s stuck-tool cancel; none of those run onDone/onError,
 * so nothing else clears the per-message streaming flags.
 */
onStreamAborted(({ chatId }) => {
  const state = useCoworkStore.getState();
  if (!state.messages[chatId]?.length) return;
  state.completeRunningTools(chatId);
  state.stopStreaming(chatId);

  // An aborted turn stops delivering tool_use events but does not un-write the
  // files it already produced, so ask the disk what is actually there. Without
  // this, a finished 18-slide deck sat in scratch while the UI showed a timeout
  // and an instruction to try again.
  const since = turnStartedAt(chatId);
  if (since === undefined) return;
  const current = useCoworkStore.getState();
  const known = [
    ...(current.artifactFiles[chatId] ?? []),
    ...(current.contextFiles[chatId] ?? []),
  ];
  void findUnregisteredArtifacts(chatId, known, since).then((paths) => {
    for (const p of paths) useCoworkStore.getState().addArtifactFile(chatId, p);
  });
});
