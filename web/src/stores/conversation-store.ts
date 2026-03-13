'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Conversation {
  id: string;
  title: string;
  surface: string;
  lastMessage: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string | null;
}

interface ConversationState {
  conversations: Conversation[];
  activeId: string | null;
}

interface ConversationActions {
  addConversation: (conversation: Conversation) => void;
  removeConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  updateConversation: (id: string, updates: Partial<Omit<Conversation, 'id'>>) => void;
  getConversationsForSurface: (surface: string) => Conversation[];
  assignToProject: (conversationId: string, projectId: string | null) => void;
}

export type ConversationStore = ConversationState & ConversationActions;

export const useConversationStore = create<ConversationStore>()(
  persist(
    (set, get) => ({
      // State
      conversations: [],
      activeId: null,

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

      getConversationsForSurface: (surface) => {
        return get().conversations.filter((c) => c.surface === surface);
      },

      assignToProject: (conversationId, projectId) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, projectId, updatedAt: Date.now() } : c
          ),
        })),
    }),
    {
      name: 'nibcowork:conversations',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    }
  )
);
