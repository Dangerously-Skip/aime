'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { surfaceTranscriptStorage } from '@/lib/transcripts/transcript-storage';
import { cleanStaleStreamingFlags, dedupeMessageIds, dedupeLegacyTranscriptRows } from '@/stores/chat-store';
import type { PendingContextItem } from '@/lib/browser-interactions';
import { createTranscriptSlice, type TranscriptSlice } from '@/stores/slices/transcript-slice';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

export type LoopPhase = 'idle' | 'observing' | 'thinking' | 'acting';

/**
 * Browser's own state; the transcript half comes from `createTranscriptSlice`.
 * Deliberately no model route: browser follows Settings with no picker.
 */
interface BrowserState {
  loopPhase: LoopPhase;
  tabSessions: Record<string, BrowserTab[]>;
  activeTabIds: Record<string, string | null>;
  inspectorMode: boolean;
  pendingContext: PendingContextItem[];
}

interface BrowserActions {
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

export type BrowserStore = TranscriptSlice & BrowserState & BrowserActions;

export const useBrowserStore = create<BrowserStore>()(
  persist(
    (set, get) => ({
      // Finishing the tools ends the reply's spinner here, as in Chat.
      ...createTranscriptSlice(set, { finishingToolsEndsReply: true }),
      loopPhase: 'idle',
      tabSessions: {},
      activeTabIds: {},
      inspectorMode: false,
      pendingContext: [],

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
      // Transcripts to IndexedDB per conversation, the rest to localStorage;
      // see lib/transcripts/transcript-storage.
      storage: surfaceTranscriptStorage('browser', (): Record<string, true> => useBrowserStore.getState().streamingChats),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        tabSessions: state.tabSessions,
        activeTabIds: state.activeTabIds,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.messages = dedupeLegacyTranscriptRows(dedupeMessageIds(cleanStaleStreamingFlags(state.messages)));
        }
      },
    }
  )
);
