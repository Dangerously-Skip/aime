'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { finishRun, startRun, summarizeRuns, applyRunToGoal } from '@/lib/runs/runs';
import type { Deliverable, Goal, Run, RunCost, RunStatus, RunSummary, RunTrigger } from '@/lib/runs/types';

/**
 * Goals + a recent window of Runs.
 *
 * STORAGE DECISION (revisit at Clawish C5): this is a *client* store with a hard
 * cap. Every chat turn is a Run, so records accumulate fast and localStorage is
 * ~5MB and synchronous — unbounded persistence here would be a real problem.
 *
 * The eventual home is server-side JSONL (the `telemetry/event-buffer` pattern),
 * which C5 forces anyway: once the run loop moves out of the renderer, work
 * happens with the window closed and a renderer store cannot observe it. Until
 * then a capped client store makes Cockpit real without that build. Keep reads
 * going through the selectors below so the backing can be swapped without
 * touching callers.
 */

/** Per-goal history cap. Enough for a sparkline and a "last N runs" list. */
export const MAX_RUNS_PER_GOAL = 50;
/** Global cap across all goals, including ad-hoc (goalId === null) runs. */
export const MAX_RUNS_TOTAL = 500;

interface RunState {
  goals: Goal[];
  /** Newest first. Capped — see the note above. */
  runs: Run[];
}

interface RunActions {
  addGoal: (goal: Goal) => void;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  setGoalEnabled: (id: string, enabled: boolean) => void;
  getGoal: (id: string) => Goal | undefined;

  /** Record the start of a run and return its id. */
  beginRun: (params: {
    id: string;
    now: number;
    goalId?: string | null;
    trigger: RunTrigger;
    surfaceId?: string;
    model?: string;
  }) => string;
  /** Move a run to a terminal state and fold the result back onto its Goal. */
  endRun: (
    id: string,
    params: {
      now: number;
      status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled' | 'timeout'>;
      error?: string;
      cost?: RunCost;
      toolCalls?: number;
      deliverables?: Deliverable[];
    },
  ) => void;
  attachDeliverable: (id: string, deliverable: Deliverable) => void;

  getRun: (id: string) => Run | undefined;
  runsForGoal: (goalId: string) => Run[];
  summaryForGoal: (goalId: string) => RunSummary;
  /** Runs still in flight — the "what's happening right now" view. */
  activeRuns: () => Run[];
  clearRuns: (goalId?: string) => void;
}

export type RunStore = RunState & RunActions;

/**
 * Enforce both caps. Per-goal first so one noisy goal cannot evict every other
 * goal's history, then the global cap as a backstop.
 */
function capRuns(runs: Run[]): Run[] {
  const perGoal = new Map<string, number>();
  const kept: Run[] = [];
  for (const run of runs) {
    const key = run.goalId ?? '__adhoc__';
    const seen = perGoal.get(key) ?? 0;
    if (seen >= MAX_RUNS_PER_GOAL) continue;
    perGoal.set(key, seen + 1);
    kept.push(run);
  }
  return kept.slice(0, MAX_RUNS_TOTAL);
}

export const useRunStore = create<RunStore>()(
  persist(
    (set, get) => ({
      goals: [],
      runs: [],

      addGoal: (goal) =>
        set((state) => ({
          // Upsert by id so re-adding edits rather than duplicates.
          goals: [...state.goals.filter((g) => g.id !== goal.id), goal],
        })),

      updateGoal: (id, patch) =>
        set((state) => ({
          goals: state.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),

      removeGoal: (id) =>
        set((state) => ({
          goals: state.goals.filter((g) => g.id !== id),
          // Drop its history too — orphaned runs would inflate the global cap
          // and leak into "recent runs" with no goal to attribute them to.
          runs: state.runs.filter((r) => r.goalId !== id),
        })),

      setGoalEnabled: (id, enabled) =>
        set((state) => ({
          goals: state.goals.map((g) => (g.id === id ? { ...g, enabled } : g)),
        })),

      getGoal: (id) => get().goals.find((g) => g.id === id),

      beginRun: (params) => {
        const run = startRun(params);
        set((state) => ({ runs: capRuns([run, ...state.runs]) }));
        return run.id;
      },

      endRun: (id, params) =>
        set((state) => {
          const existing = state.runs.find((r) => r.id === id);
          // A run evicted by the cap, or an unknown id, is a no-op rather than
          // an error — telemetry must never break the thing it measures.
          if (!existing) return state;
          const finished = finishRun(existing, params);
          if (finished === existing) return state; // already terminal
          return {
            runs: state.runs.map((r) => (r.id === id ? finished : r)),
            goals: finished.goalId
              ? state.goals.map((g) => (g.id === finished.goalId ? applyRunToGoal(g, finished) : g))
              : state.goals,
          };
        }),

      attachDeliverable: (id, deliverable) =>
        set((state) => ({
          runs: state.runs.map((r) =>
            r.id === id ? { ...r, deliverables: [...r.deliverables, deliverable] } : r,
          ),
        })),

      getRun: (id) => get().runs.find((r) => r.id === id),
      runsForGoal: (goalId) => get().runs.filter((r) => r.goalId === goalId),
      summaryForGoal: (goalId) => summarizeRuns(get().runs.filter((r) => r.goalId === goalId)),
      activeRuns: () => get().runs.filter((r) => r.status === 'running' || r.status === 'awaiting_approval'),

      clearRuns: (goalId) =>
        set((state) => ({
          runs: goalId ? state.runs.filter((r) => r.goalId !== goalId) : [],
        })),
    }),
    {
      name: 'aime:runs',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      partialize: (state) => ({ goals: state.goals, runs: state.runs }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // A run left 'running' by a crash or a closed window is not running now.
        // Without this it would show a spinner forever and skew activeRuns().
        state.runs = state.runs.map((r) =>
          r.status === 'running' || r.status === 'awaiting_approval'
            ? { ...r, status: 'cancelled' as const, error: 'Interrupted — the app closed before this run finished' }
            : r,
        );
      },
    },
  ),
);
