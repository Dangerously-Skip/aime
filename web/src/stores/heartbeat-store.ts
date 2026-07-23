'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';

export interface HeartbeatEntry {
  id: string;
  timestamp: number;
  summary: string;
  type: 'heartbeat' | 'cron';
  unread: boolean;
}

interface HeartbeatState {
  entries: HeartbeatEntry[];
}

interface HeartbeatActions {
  addEntry(e: Omit<HeartbeatEntry, 'id'>): void;
  markAllRead(): void;
  dismissEntry(id: string): void;
  clearOlderThan(days: number): void;
}

export type HeartbeatStore = HeartbeatState & HeartbeatActions;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const useHeartbeatStore = create<HeartbeatStore>()(
  persist(
    (set) => ({
      entries: [],

      addEntry: (e) =>
        set((state) => {
          const now = Date.now();
          const pruned = state.entries.filter((x) => now - x.timestamp < THIRTY_DAYS_MS);
          return {
            entries: [
              {
                ...e,
                id: crypto.randomUUID(),
                summary: e.summary.slice(0, 1000),
              },
              ...pruned,
            ],
          };
        }),

      markAllRead: () =>
        set((state) => ({
          entries: state.entries.map((e) => ({ ...e, unread: false })),
        })),

      dismissEntry: (id) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        })),

      clearOlderThan: (days) =>
        set((state) => {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          return { entries: state.entries.filter((e) => e.timestamp >= cutoff) };
        }),
    }),
    {
      name: 'aime:heartbeat',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
    }
  )
);
