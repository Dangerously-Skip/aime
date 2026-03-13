'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Message, ToolCall, ModelId } from '@/stores/chat-store';
import type { PendingContextItem } from '@/lib/browser-interactions';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

export type LoopPhase = 'idle' | 'observing' | 'thinking' | 'acting';

interface BrowserState {
  messages: Record<string, Message[]>;
  currentChatId: string | null;
  model: ModelId;
  isStreaming: boolean;
  loopPhase: LoopPhase;
  tabs: BrowserTab[];
  activeTabId: string | null;
  inspectorMode: boolean;
  pendingContext: PendingContextItem[];
}

interface BrowserActions {
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
  addTab: (tab: BrowserTab) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabUrl: (tabId: string, url: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  setLoopPhase: (phase: LoopPhase) => void;
  setInspectorMode: (active: boolean) => void;
  addPendingContext: (item: PendingContextItem) => void;
  removePendingContext: (id: string) => void;
  clearPendingContext: () => void;
}

export type BrowserStore = BrowserState & BrowserActions;

export const useBrowserStore = create<BrowserStore>()(
  persist(
    (set) => ({
      messages: {},
      currentChatId: null,
      model: 'sonnet',
      isStreaming: false,
      loopPhase: 'idle',
      tabs: [],
      activeTabId: null,
      inspectorMode: false,
      pendingContext: [],

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

      setLoopPhase: (phase) => set({ loopPhase: phase }),

      addTab: (tab) =>
        set((state) => ({
          tabs: [...state.tabs.map((t) => ({ ...t, isActive: false })), { ...tab, isActive: true }],
          activeTabId: tab.id,
        })),

      removeTab: (tabId) =>
        set((state) => {
          const filtered = state.tabs.filter((t) => t.id !== tabId);
          const wasActive = state.activeTabId === tabId;

          if (wasActive && filtered.length > 0) {
            const lastTab = filtered[filtered.length - 1];
            return {
              tabs: filtered.map((t) => ({ ...t, isActive: t.id === lastTab.id })),
              activeTabId: lastTab.id,
            };
          }

          if (wasActive && filtered.length === 0) {
            return { tabs: [], activeTabId: null };
          }

          return { tabs: filtered };
        }),

      setActiveTab: (tabId) =>
        set((state) => ({
          tabs: state.tabs.map((t) => ({ ...t, isActive: t.id === tabId })),
          activeTabId: tabId,
        })),

      updateTabUrl: (tabId, url) =>
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, url } : t)),
        })),

      updateTabTitle: (tabId, title) =>
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
        })),

      setInspectorMode: (active) => set({ inspectorMode: active }),

      addPendingContext: (item) =>
        set((state) => ({ pendingContext: [...state.pendingContext, item] })),

      removePendingContext: (id) =>
        set((state) => ({
          pendingContext: state.pendingContext.filter((c) => c.id !== id),
        })),

      clearPendingContext: () => set({ pendingContext: [] }),
    }),
    {
      name: 'nibcowork:browser',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        messages: state.messages,
        model: state.model,
        currentChatId: state.currentChatId,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
      skipHydration: true,
    }
  )
);
