'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { Message, ToolCall, ModelId } from '@/stores/chat-store';
import { cleanStaleStreamingFlags, dedupeMessageIds } from '@/stores/chat-store';
import type { PendingContextItem } from '@/lib/browser-interactions';
import { withToolCall, withToolResult } from '@/lib/stores/tool-call-reducers';

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
  isStreaming: boolean;
  loopPhase: LoopPhase;
  tabSessions: Record<string, BrowserTab[]>;
  activeTabIds: Record<string, string | null>;
  inspectorMode: boolean;
  pendingContext: PendingContextItem[];
}

interface BrowserActions {
  addMessage: (chatId: string, message: Message) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  startStreaming: (chatId: string) => void;
  stopStreaming: (chatId: string) => void;
  setCurrentChat: (chatId: string | null) => void;
  clearMessages: (chatId: string) => void;
  addToolCall: (chatId: string, toolCall: ToolCall) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  /**
   * Close out tools still marked running.
   *
   * Required by `handleCoreChunk`, which every other surface already routes its
   * SSE events through. The browser surface had its own hand-rolled loop and so
   * never needed it — the same reason it had the weakest agent in the app.
   */
  completeRunningTools: (chatId: string) => void;
  addTab: (tab: BrowserTab, chatId?: string) => void;
  removeTab: (tabId: string, chatId?: string) => void;
  setActiveTab: (tabId: string, chatId?: string) => void;
  updateTabUrl: (tabId: string, url: string, chatId?: string) => void;
  updateTabTitle: (tabId: string, title: string, chatId?: string) => void;
  getTabsForChat: (chatId: string) => BrowserTab[];
  getActiveTabIdForChat: (chatId: string) => string | null;
  setLoopPhase: (phase: LoopPhase) => void;
  setInspectorMode: (active: boolean) => void;
  addPendingContext: (item: PendingContextItem) => void;
  removePendingContext: (id: string) => void;
  clearPendingContext: () => void;
}

export type BrowserStore = BrowserState & BrowserActions;

export const useBrowserStore = create<BrowserStore>()(
  persist(
    (set, get) => ({
      messages: {},
      currentChatId: null,
      isStreaming: false,
      loopPhase: 'idle',
      tabSessions: {},
      activeTabIds: {},
      inspectorMode: false,
      pendingContext: [],

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
          // No-op when nothing is running, so a stream of text events does not
          // rewrite the message array on every chunk.
          if (!last.toolCalls.some((tc) => tc.status === 'running')) return state;
          const updated = [...msgs];
          updated[lastIdx] = {
            ...last,
            isLoading: false,
            isStreaming: false,
            toolCalls: last.toolCalls.map((tc) =>
              tc.status === 'running'
                ? { ...tc, status: 'complete' as const, endTime: Date.now() }
                : tc,
            ),
          };
          return { messages: { ...state.messages, [chatId]: updated } };
        }),

      setLoopPhase: (phase) => set({ loopPhase: phase }),

      getTabsForChat: (chatId: string) => {
        return get().tabSessions[chatId] ?? [];
      },

      getActiveTabIdForChat: (chatId: string) => {
        return get().activeTabIds[chatId] ?? null;
      },

      addTab: (tab, chatId) =>
        set((state) => {
          const cid = chatId ?? state.currentChatId;
          if (!cid) return state;
          const existing = state.tabSessions[cid] ?? [];
          return {
            tabSessions: {
              ...state.tabSessions,
              [cid]: [...existing.map((t) => ({ ...t, isActive: false })), { ...tab, isActive: true }],
            },
            activeTabIds: { ...state.activeTabIds, [cid]: tab.id },
          };
        }),

      removeTab: (tabId, chatId) =>
        set((state) => {
          const cid = chatId ?? state.currentChatId;
          if (!cid) return state;
          const tabs = state.tabSessions[cid] ?? [];
          const filtered = tabs.filter((t) => t.id !== tabId);
          const wasActive = state.activeTabIds[cid] === tabId;

          if (wasActive && filtered.length > 0) {
            const lastTab = filtered[filtered.length - 1];
            return {
              tabSessions: {
                ...state.tabSessions,
                [cid]: filtered.map((t) => ({ ...t, isActive: t.id === lastTab.id })),
              },
              activeTabIds: { ...state.activeTabIds, [cid]: lastTab.id },
            };
          }

          if (wasActive && filtered.length === 0) {
            return {
              tabSessions: { ...state.tabSessions, [cid]: [] },
              activeTabIds: { ...state.activeTabIds, [cid]: null },
            };
          }

          return {
            tabSessions: { ...state.tabSessions, [cid]: filtered },
          };
        }),

      setActiveTab: (tabId, chatId) =>
        set((state) => {
          const cid = chatId ?? state.currentChatId;
          if (!cid) return state;
          const tabs = state.tabSessions[cid] ?? [];
          return {
            tabSessions: {
              ...state.tabSessions,
              [cid]: tabs.map((t) => ({ ...t, isActive: t.id === tabId })),
            },
            activeTabIds: { ...state.activeTabIds, [cid]: tabId },
          };
        }),

      updateTabUrl: (tabId, url, chatId) =>
        set((state) => {
          const cid = chatId ?? state.currentChatId;
          if (!cid) return state;
          const tabs = state.tabSessions[cid] ?? [];
          return {
            tabSessions: {
              ...state.tabSessions,
              [cid]: tabs.map((t) => (t.id === tabId ? { ...t, url } : t)),
            },
          };
        }),

      updateTabTitle: (tabId, title, chatId) =>
        set((state) => {
          const cid = chatId ?? state.currentChatId;
          if (!cid) return state;
          const tabs = state.tabSessions[cid] ?? [];
          return {
            tabSessions: {
              ...state.tabSessions,
              [cid]: tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
            },
          };
        }),

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
      name: 'aime:browser',
      storage: createJSONStorage(() => getGatedStorage()),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        tabSessions: state.tabSessions,
        activeTabIds: state.activeTabIds,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.messages = dedupeMessageIds(cleanStaleStreamingFlags(state.messages));
        }
      },
    }
  )
);
