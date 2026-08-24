'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';

export interface CronJob {
  id: string;
  expression: string; // cron expression, e.g. "0 9 * * 1"
  prompt: string;
  surfaceId: string;
  projectId?: string;  // optional project association
  lastRun: number | null;
  enabled: boolean;
  createdAt: number;
}

interface CronState {
  jobs: CronJob[];
}

interface CronActions {
  addJob: (job: Omit<CronJob, 'id' | 'createdAt' | 'lastRun'>) => string;
  getJobsForProject: (projectId: string) => CronJob[];
  removeJob: (id: string) => void;
  updateJob: (id: string, updates: Partial<CronJob>) => void;
  markRan: (id: string) => void;
  toggleJob: (id: string) => void;
}

export type CronStore = CronState & CronActions;

export const useCronStore = create<CronStore>()(
  persist(
    (set, get) => ({
      jobs: [],

      addJob: (job) => {
        const id = crypto.randomUUID();
        set((state) => ({
          jobs: [...state.jobs, {
            ...job,
            id,
            lastRun: null,
            createdAt: Date.now(),
          }],
        }));
        return id;
      },

      removeJob: (id) =>
        set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) })),

      updateJob: (id, updates) =>
        set((state) => ({
          jobs: state.jobs.map((j) => j.id === id ? { ...j, ...updates } : j),
        })),

      markRan: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) => j.id === id ? { ...j, lastRun: Date.now() } : j),
        })),

      toggleJob: (id) =>
        set((state) => ({
          jobs: state.jobs.map((j) => j.id === id ? { ...j, enabled: !j.enabled } : j),
        })),

      getJobsForProject: (projectId) =>
        get().jobs.filter((j) => j.projectId === projectId),
    }),
    {
      name: 'aime:cron',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
    }
  )
);

/*
 * `matchesCron` LIVES IN `lib/schedule/due.ts` NOW.
 *
 * It is a pure function and it was sitting in a `'use client'` store, so the
 * server-side scheduler could not import it without dragging zustand into the
 * server bundle — and worked around that with a defensive dynamic import that
 * skipped cron orders for a whole tick if it failed.
 *
 * Re-exported here because callers already import it from this module and there
 * is no reason to churn them.
 */
export { matchesCron } from '@/lib/schedule/due';

