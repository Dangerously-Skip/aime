'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { type SessionControls, DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';

export type ModelId = 'sonnet' | 'opus' | 'haiku';
export type { SessionControls };

const VALID_MODELS: Set<string> = new Set<string>(['sonnet', 'opus', 'haiku']);

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
  /** Auto-continue message injected by the system, not typed by the user */
  isAutoContinue?: boolean;
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

interface ChatState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  model: ModelId;
  isStreaming: boolean;
  streamError: string | null;
  sessionControls: Record<string, SessionControls>;
  lastActivityAt: Record<string, number>;
  suggestions: Record<string, string[]>;
}

interface ChatActions {
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  setModel: (model: string) => void;
  startStreaming: (chatId: string) => void;
  stopStreaming: (chatId: string) => void;
  setCurrentChat: (chatId: string) => void;
  clearMessages: (chatId: string) => void;
  addToolCall: (chatId: string, toolCall: ToolCall) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  updateMessageContent: (chatId: string, messageId: string, content: string) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
  getSessionControls: (chatId: string) => SessionControls;
  touchActivity: (chatId: string) => void;
  setIsStreaming: (v: boolean) => void;
  setStreamError: (e: string | null) => void;
  addSuggestion: (chatId: string, suggestion: string) => void;
  clearSuggestions: (chatId: string) => void;
}

export type ChatStore = ChatState & ChatActions;

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      model: 'sonnet',
      isStreaming: false,
      streamError: null,
      sessionControls: {},
      lastActivityAt: {},
      suggestions: {},

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
          console.warn(`[ChatStore] Invalid model "${model}", keeping current`);
        }
      },

      startStreaming: (chatId) => set((state) => ({
        isStreaming: true,
        // Also mark by chatId so callers can check which chat is streaming
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

      updateMessageContent: (chatId, messageId, content) =>
        set((state) => {
          const msgs = state.messages[chatId];
          if (!msgs?.length) return state;
          const updated = msgs.map((m) => m.id === messageId ? { ...m, content } : m);
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
      setStreamError: (e) => set({ streamError: e }),

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
    }),
    {
      name: 'nibcowork:chat',
      storage: createJSONStorage(() => getGatedStorage()),
      partialize: (state) => ({
        messages: state.messages,
        model: state.model,
        currentChatId: state.currentChatId,
        sessionControls: state.sessionControls,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) state.messages = cleanStaleStreamingFlags(state.messages);
      },
    }
  )
);
