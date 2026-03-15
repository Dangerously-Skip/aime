'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Memory, MemoryCategory, MemoryScope } from '@/lib/memory/types';
import { getMemoriesForContext, searchMemories, findDuplicate } from '@/lib/memory/retriever';

const MAX_MEMORY_COUNT = 500;
const SUPERSEDED_CLEANUP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface MemoryState {
  memories: Memory[];
}

interface MemoryActions {
  addMemory: (memory: Memory) => void;
  updateMemory: (id: string, updates: Partial<Omit<Memory, 'id'>>) => void;
  supersedeMemory: (oldId: string, newMemory: Memory) => void;
  removeMemory: (id: string) => void;
  getMemoriesForContext: (ctx?: {
    projectId?: string | null;
    query?: string;
    limit?: number;
    categories?: MemoryCategory[];
  }) => Memory[];
  searchMemories: (query: string) => Memory[];
  addMemoryWithDedup: (memory: Memory) => void;
  touchMemory: (id: string) => void;
  /** Hard-delete superseded memories older than 30 days and enforce count limit. */
  cleanupMemories: () => number;
}

export type MemoryStore = MemoryState & MemoryActions;

export const useMemoryStore = create<MemoryStore>()(
  persist(
    (set, get) => ({
      memories: [],

      addMemory: (memory) =>
        set((state) => ({
          memories: [memory, ...state.memories],
        })),

      updateMemory: (id, updates) =>
        set((state) => ({
          memories: state.memories.map((m) =>
            m.id === id ? { ...m, ...updates, updatedAt: Date.now() } : m
          ),
        })),

      supersedeMemory: (oldId, newMemory) =>
        set((state) => ({
          memories: [
            newMemory,
            ...state.memories.map((m) =>
              m.id === oldId ? { ...m, supersededBy: newMemory.id, updatedAt: Date.now() } : m
            ),
          ],
        })),

      removeMemory: (id) =>
        set((state) => ({
          memories: state.memories.filter((m) => m.id !== id),
        })),

      getMemoriesForContext: (ctx) => {
        return getMemoriesForContext(get().memories, ctx);
      },

      searchMemories: (query) => {
        return searchMemories(get().memories, query);
      },

      addMemoryWithDedup: (memory) => {
        const state = get();
        const duplicate = findDuplicate(state.memories, memory.content, memory.tags);
        if (duplicate) {
          // Supersede the old memory with the new one
          set({
            memories: [
              memory,
              ...state.memories.map((m) =>
                m.id === duplicate.id
                  ? { ...m, supersededBy: memory.id, updatedAt: Date.now() }
                  : m
              ),
            ],
          });
        } else {
          set({ memories: [memory, ...state.memories] });
        }
      },

      touchMemory: (id) =>
        set((state) => ({
          memories: state.memories.map((m) =>
            m.id === id
              ? { ...m, accessCount: m.accessCount + 1, lastAccessedAt: Date.now() }
              : m
          ),
        })),

      cleanupMemories: () => {
        const state = get();
        const now = Date.now();
        // Remove superseded memories older than 30 days
        let cleaned = state.memories.filter((m) => {
          if (m.supersededBy && (now - m.updatedAt) > SUPERSEDED_CLEANUP_MS) return false;
          return true;
        });
        const removed = state.memories.length - cleaned.length;
        // Enforce count limit — keep most recently accessed
        if (cleaned.length > MAX_MEMORY_COUNT) {
          cleaned = cleaned
            .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
            .slice(0, MAX_MEMORY_COUNT);
        }
        set({ memories: cleaned });
        return removed + (state.memories.length - removed - cleaned.length);
      },
    }),
    {
      name: 'nibcowork:memories',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        // Run cleanup on rehydration to purge stale superseded memories
        if (state) {
          state.cleanupMemories();
        }
      },
    }
  )
);
