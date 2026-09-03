'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { onStreamAborted } from '@/lib/stream-registry';
import type { Message, ToolCall, ModelId } from '@/stores/chat-store';
import type { ModelOption } from '@/lib/models/client-options';
import { cleanStaleStreamingFlags, dedupeMessageIds } from '@/stores/chat-store';
import { type SessionControls, DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';
import { withToolCall, withToolResult } from '@/lib/stores/tool-call-reducers';

export type PermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypass';
export type SessionStatus = 'idle' | 'active' | 'streaming';
export type ConnectionType = 'local' | 'github';

interface CodeState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  /**
   * Selected route — a tier or a pinned model (in-memory); null ⇒ use the
   * built-in `model` enum.
   */
  modelRoute: ModelOption | null;
  isStreaming: boolean;
  folderByChat: Record<string, string | null>;
  permissionMode: PermissionMode;
  sessionStatus: SessionStatus;
  connectionType: ConnectionType;
  planContent: Record<string, string>;
  planOpen: boolean;
  sessionControls: Record<string, SessionControls>;
}

interface CodeActions {
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  setModelRoute: (opt: ModelOption | null) => void;
  startStreaming: (chatId: string) => void;
  stopStreaming: (chatId: string) => void;
  setCurrentChat: (chatId: string | null) => void;
  clearMessages: (chatId: string) => void;
  addToolCall: (chatId: string, toolCall: ToolCall) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  completeRunningTools: (chatId: string) => void;
  setFolder: (chatId: string, folder: string | null) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setConnectionType: (type: ConnectionType) => void;
  setPlanContent: (chatId: string, content: string) => void;
  setPlanOpen: (open: boolean) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
  setIsStreaming: (v: boolean) => void;
}

export { DEFAULT_SESSION_CONTROLS };

export type CodeStore = CodeState & CodeActions;

export const useCodeStore = create<CodeStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      modelRoute: null,
      isStreaming: false,
      folderByChat: {},
      permissionMode: 'default',
      sessionStatus: 'idle',
      connectionType: 'local',
      planContent: {},
      planOpen: false,
      sessionControls: {},

      // Idempotent by id, inside `set` — see chat-store's addMessage for why.
      // Every message store carries this: the goal transcript posts through
      // whichever store owns the surface, and the guard was on only one of them.
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
            ...(thinking ? { thinking: (last.thinking || '') + thinking } : {}),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      setModelRoute: (opt) => set({ modelRoute: opt }),

      startStreaming: () => set({ isStreaming: true }),

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
          const next = withToolCall(state.messages, chatId, toolCall);
          return next ? { messages: next } : state;
        }),

      updateToolResult: (chatId, toolCallId, output, isError) =>
        set((state) => {
          const next = withToolResult(state.messages, chatId, toolCallId, output, isError, Date.now());
          return next ? { messages: next } : state;
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
      setPermissionMode: (mode) => set({ permissionMode: mode }),
      setSessionStatus: (status) => set({ sessionStatus: status }),
      setConnectionType: (connectionType) => set({ connectionType }),

      setPlanContent: (chatId, content) =>
        set((state) => ({
          planContent: { ...state.planContent, [chatId]: content },
        })),

      setPlanOpen: (open) => set({ planOpen: open }),

      setSessionControls: (chatId, controls) =>
        set((state) => ({
          sessionControls: { ...state.sessionControls, [chatId]: controls },
        })),

      setIsStreaming: (v) => set({ isStreaming: v }),
    }),
    {
      name: 'aime:code',
      storage: createJSONStorage(() => getGatedStorage()),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        folderByChat: state.folderByChat,
        permissionMode: state.permissionMode,
        connectionType: state.connectionType,
        planContent: state.planContent,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) state.messages = dedupeMessageIds(cleanStaleStreamingFlags(state.messages));
      },
    }
  )
);

/**
 * Finalise a turn whose stream was aborted — see the matching subscription in
 * chat-store.
 */
onStreamAborted(({ chatId }) => {
  const state = useCodeStore.getState();
  if (!state.messages[chatId]?.length) return;
  state.completeRunningTools(chatId);
  state.stopStreaming(chatId);
});
