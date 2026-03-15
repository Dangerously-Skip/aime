'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Message, ToolCall, ModelId } from '@/stores/chat-store';

const VALID_MODELS: Set<string> = new Set<string>(['sonnet', 'opus', 'haiku']);

interface CoworkState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  model: ModelId;
  isStreaming: boolean;
  folder: string | null;
  contextFiles: Record<string, string[]>;
  artifactFiles: Record<string, string[]>;
}

interface CoworkActions {
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
  setFolder: (folder: string | null) => void;
  addContextFile: (chatId: string, path: string) => void;
  addArtifactFile: (chatId: string, path: string) => void;
  clearSidebarFiles: (chatId: string) => void;
}

export type CoworkStore = CoworkState & CoworkActions;

export const useCoworkStore = create<CoworkStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      model: 'opus',
      isStreaming: false,
      folder: null,
      contextFiles: {},
      artifactFiles: {},

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

      setModel: (model) => {
        if (VALID_MODELS.has(model)) {
          set({ model: model as ModelId });
        } else {
          console.warn(`[CoworkStore] Invalid model "${model}", keeping current`);
        }
      },

      startStreaming: (chatId) => set((state) => ({
        isStreaming: true,
        currentChatId: chatId || state.currentChatId,
      })),

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

      setFolder: (folder) => set({ folder }),

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

      clearSidebarFiles: (chatId) =>
        set((state) => {
          const { [chatId]: _ctx, ...restCtx } = state.contextFiles;
          const { [chatId]: _art, ...restArt } = state.artifactFiles;
          return { contextFiles: restCtx, artifactFiles: restArt };
        }),
    }),
    {
      name: 'nibcowork:cowork',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        messages: state.messages,
        model: state.model,
        currentChatId: state.currentChatId,
        folder: state.folder,
        contextFiles: state.contextFiles,
        artifactFiles: state.artifactFiles,
      }),
      skipHydration: true,
    }
  )
);
