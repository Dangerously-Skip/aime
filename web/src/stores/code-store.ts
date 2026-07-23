'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { Message, ToolCall, ModelId } from '@/stores/chat-store';
import { cleanStaleStreamingFlags } from '@/stores/chat-store';
import { type SessionControls, DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';

export type PermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypass';
export type SessionStatus = 'idle' | 'active' | 'streaming';
export type ConnectionType = 'local' | 'github';

interface CodeState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  model: ModelId;
  isStreaming: boolean;
  streamError: string | null;
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
  setModel: (model: string) => void;
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
  setStreamError: (e: string | null) => void;
}

export { DEFAULT_SESSION_CONTROLS };

export type CodeStore = CodeState & CodeActions;

export const useCodeStore = create<CodeStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      model: 'sonnet',
      isStreaming: false,
      streamError: null,
      folderByChat: {},
      permissionMode: 'default',
      sessionStatus: 'idle',
      connectionType: 'local',
      planContent: {},
      planOpen: false,
      sessionControls: {},

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

      setModel: (model) => set({ model: model as ModelId }),

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
      setStreamError: (e) => set({ streamError: e }),
    }),
    {
      name: 'aime:code',
      storage: createJSONStorage(() => getGatedStorage()),
      partialize: (state) => ({
        messages: state.messages,
        model: state.model,
        currentChatId: state.currentChatId,
        folderByChat: state.folderByChat,
        permissionMode: state.permissionMode,
        connectionType: state.connectionType,
        planContent: state.planContent,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) state.messages = cleanStaleStreamingFlags(state.messages);
      },
    }
  )
);
