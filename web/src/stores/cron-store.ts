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

/**
 * Simple cron expression matcher.
 * Supports: minute hour dom month dow (standard 5-field cron)
 * Returns true if the given date matches the expression.
 */
export function matchesCron(expression: string, date: Date = new Date()): boolean {
  try {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [min, hour, dom, month, dow] = parts;

    const matches = (field: string, value: number): boolean => {
      if (field === '*') return true;
      // Comma-separated list
      if (field.includes(',')) {
        return field.split(',').some((f) => matches(f.trim(), value));
      }
      // Step values: */5, 0-59/5
      if (field.includes('/')) {
        const [range, step] = field.split('/');
        const stepNum = parseInt(step, 10);
        if (isNaN(stepNum)) return false;
        const [start, end] = range === '*'
          ? [0, 59]
          : range.split('-').map(Number);
        if (value < start || value > end) return false;
        return (value - start) % stepNum === 0;
      }
      // Range: 0-5
      if (field.includes('-')) {
        const [start, end] = field.split('-').map(Number);
        return value >= start && value <= end;
      }
      // Exact value
      return parseInt(field, 10) === value;
    };

    return (
      matches(min, date.getMinutes()) &&
      matches(hour, date.getHours()) &&
      matches(dom, date.getDate()) &&
      matches(month, date.getMonth() + 1) &&
      matches(dow, date.getDay())
    );
  } catch {
    return false;
  }
}
