'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';

export interface ConversationTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
  durationMs: number;
  toolCallCount: number;
  ttftMs?: number;
}

export interface ConversationEffortEstimate {
  hours: number;
  complexity: 'low' | 'medium' | 'high';
  reasoning: string;
  taskType: string;
  domain: string;
  language: string;
}

export interface ConversationROI {
  multiplier: number;
  dollarsSaved: number;
}

export interface ConversationSessionStats {
  toolCallCount: number;
  artifactCount: number;
  messageCount: number;
  aborted: boolean;
  clarificationCount: number;
  thinkingUsed: boolean;
  connectors: string[];
  toolProfile: string;
}

export interface Conversation {
  id: string;
  title: string;
  surface: string;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string | null;
  compactedAt?: number | null;
  summaryContent?: string | null;
  sessionResetAt?: number | null;
  /** True for automated background runs (heartbeat, cron) — hidden from main chat list */
  isBackground?: boolean;
  tokenUsage?: ConversationTokenUsage;
  effortEstimate?: ConversationEffortEstimate;
  roi?: ConversationROI;
  sessionStats?: ConversationSessionStats;
  userRating?: 1 | -1;
}

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
  navigationHistory: string[];
  navigationIndex: number;
}

export type ConversationMetrics = {
  tokenUsage?: ConversationTokenUsage;
  effortEstimate?: ConversationEffortEstimate;
  roi?: ConversationROI;
  sessionStats?: Partial<ConversationSessionStats>;
  userRating?: 1 | -1;
};

interface ConversationActions {
  addConversation: (conversation: Conversation) => void;
  removeConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  updateConversation: (id: string, updates: Partial<Omit<Conversation, 'id'>>) => void;
  updateConversationMetrics: (id: string, metrics: ConversationMetrics) => void;
  getConversationsForSurface: (surface: string) => Conversation[];
  assignToProject: (conversationId: string, projectId: string | null) => void;
  navigateTo: (id: string) => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
}

export type ConversationStore = ConversationState & ConversationActions;

export const useConversationStore = create<ConversationStore>()(
  persist(
    (set, get) => ({
      // State
      conversations: [],
      activeId: null,
      navigationHistory: [],
      navigationIndex: -1,

      // Actions
      addConversation: (conversation) =>
        set((state) => ({
          conversations: [conversation, ...state.conversations],
        })),

      removeConversation: (id) =>
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        })),

      setActiveConversation: (id) => set({ activeId: id }),

      updateConversation: (id, updates) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
          ),
        })),

      updateConversationMetrics: (id, metrics) =>
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id !== id) return c;
            return {
              ...c,
              ...(metrics.tokenUsage ? { tokenUsage: metrics.tokenUsage } : {}),
              ...(metrics.effortEstimate ? { effortEstimate: metrics.effortEstimate } : {}),
              ...(metrics.roi ? { roi: metrics.roi } : {}),
              ...(metrics.sessionStats ? { sessionStats: { ...c.sessionStats, ...metrics.sessionStats } as ConversationSessionStats } : {}),
              ...(metrics.userRating !== undefined ? { userRating: metrics.userRating } : {}),
            };
          }),
        })),

      getConversationsForSurface: (surface) => {
        return get().conversations.filter((c) => c.surface === surface);
      },

      assignToProject: (conversationId, projectId) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, projectId, updatedAt: Date.now() } : c
          ),
        })),

      navigateTo: (id) =>
        set((state) => {
          const current = state.navigationHistory[state.navigationIndex];
          if (current === id) return { activeId: id };
          const truncated = state.navigationHistory.slice(0, state.navigationIndex + 1);
          return {
            activeId: id,
            navigationHistory: [...truncated, id].slice(-50),
            navigationIndex: truncated.length,
          };
        }),

      goBack: () =>
        set((state) => {
          if (state.navigationIndex <= 0) return {};
          const newIndex = state.navigationIndex - 1;
          return { activeId: state.navigationHistory[newIndex], navigationIndex: newIndex };
        }),

      goForward: () =>
        set((state) => {
          if (state.navigationIndex >= state.navigationHistory.length - 1) return {};
          const newIndex = state.navigationIndex + 1;
          return { activeId: state.navigationHistory[newIndex], navigationIndex: newIndex };
        }),

      canGoBack: () => get().navigationIndex > 0,
      canGoForward: () => get().navigationIndex < get().navigationHistory.length - 1,
    }),
    {
      name: 'nibcowork:conversations',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Retroactively flag legacy [auto] conversations created before isBackground was added
        const needsMigration = state.conversations.some(
          (c) => !c.isBackground && c.title.startsWith('[auto]')
        );
        if (needsMigration) {
          state.conversations = state.conversations.map((c) =>
            !c.isBackground && c.title.startsWith('[auto]')
              ? { ...c, isBackground: true }
              : c
          );
        }
      },
    }
  )
);
