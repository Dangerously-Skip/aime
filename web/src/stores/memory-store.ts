'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { Memory, MemoryCategory, MemoryScope } from '@/lib/memory/types';
import { getMemoriesForContext, searchMemories, findDuplicate, findSimilar } from '@/lib/memory/retriever';

const PRUNE_TRIGGER = 600;
const PRUNE_TARGET = 500;
const SUPERSEDED_CLEANUP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Category weights for differential decay. Higher = longer-lived. */
const CATEGORY_WEIGHTS: Record<string, number> = {
  preference: 0.9,
  skill: 0.9,
  fact: 0.7,
  relationship: 0.7,
  episodic: 0.5,
  pattern: 0.4,
  decision: 0.3,
};

/**
 * Compute a retention score for a memory.
 * Higher score = more likely to be kept during pruning.
 */
function retentionScore(m: Memory): number {
  const confidence = m.confidence;
  const accessFreq = Math.min(m.accessCount / 20, 1); // normalize, cap at 20 accesses
  const ageDays = (Date.now() - m.lastAccessedAt) / (1000 * 60 * 60 * 24);
  const recencyDecay = Math.max(0, 1 - ageDays / 60); // 60-day decay window for pruning
  const categoryWeight = CATEGORY_WEIGHTS[m.category] ?? 0.5;
  return confidence * 0.3 + accessFreq * 0.3 + recencyDecay * 0.2 + categoryWeight * 0.2;
}

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
  /** Hard-delete superseded memories older than 30 days and prune by retention score. */
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
        const match = findSimilar(state.memories, memory.content, memory.tags);

        if (match?.level === 'duplicate') {
          // Supersede the old memory with the new one
          set({
            memories: [
              memory,
              ...state.memories.map((m) =>
                m.id === match.memory.id
                  ? { ...m, supersededBy: memory.id, updatedAt: Date.now() }
                  : m
              ),
            ],
          });
        } else if (match?.level === 'similar') {
          // Merge: update existing memory's content, bump confidence, increment updatedCount
          const existing = match.memory;
          const mergedContent = existing.content.length >= memory.content.length
            ? existing.content
            : memory.content;
          const mergedTags = [...new Set([...existing.tags, ...memory.tags])];
          const bumpedConfidence = Math.min(1, existing.confidence + 0.05);
          const count = (existing.updatedCount || 0) + 1;
          set({
            memories: state.memories.map((m) =>
              m.id === existing.id
                ? {
                    ...m,
                    content: mergedContent,
                    tags: mergedTags,
                    confidence: bumpedConfidence,
                    updatedCount: count,
                    updatedAt: Date.now(),
                    lastAccessedAt: Date.now(),
                  }
                : m
            ),
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

        // Differential decay pruning: when above PRUNE_TRIGGER, prune to PRUNE_TARGET
        if (cleaned.length > PRUNE_TRIGGER) {
          cleaned = cleaned
            .map((m) => ({ memory: m, score: retentionScore(m) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, PRUNE_TARGET)
            .map((s) => s.memory);
        }

        set({ memories: cleaned });
        return removed + Math.max(0, state.memories.length - removed - cleaned.length);
      },
    }),
    {
      name: 'nibcowork:memories',
      storage: createJSONStorage(() => getGatedStorage()),
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
