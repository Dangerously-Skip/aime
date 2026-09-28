'use client';

import { useEffect } from 'react';
import { useHarnessStatus } from '@/hooks/use-harness-status';
import { Loader2 } from 'lucide-react';
import { GoalPanel } from './goal-panel';

/**
 * The run's status, when there is a run.
 *
 * Renders nothing at all when this conversation has no goal, so ordinary chat is
 * untouched. Separate from the composer's goal-mode controls because they answer
 * different questions — "start one" and "what is the one I started doing" — and
 * the previous version conflated them into a single box that showed a start form
 * while a run was already going.
 */
export function GoalRunStatus({
  chatId,
  folder,
  surfaceId,
  starting = null,
  nudge = 0,
}: {
  chatId: string;
  folder: string | null;
  surfaceId: 'cowork' | 'code';
  /**
   * What the run is doing before it exists.
   *
   * Planning is a full model call — thirty seconds or more — and until this
   * existed the screen showed nothing at all during it. The send button went
   * quiet and the panel appeared a minute later, which reads as nothing having
   * happened.
   */
  starting?: { objective: string; phase: 'planning' | 'starting' } | null;
  /** Bumped by the caller to force an immediate re-check rather than waiting. */
  nudge?: number;
}) {
  // The shared status poll (hooks/use-harness-status) — not a 3s poll of its own.
  const { status, refresh } = useHarnessStatus(chatId, folder);
  const hasGoal = !!status?.goal;

  // A nudge (a goal just started) re-checks now rather than at the next poll.
  useEffect(() => {
    if (nudge) void refresh();
  }, [nudge, refresh]);

  if (!folder) return null;

  // Planning, before there is anything to report.
  if (starting && !hasGoal) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {starting.phase === 'planning' ? 'Working out a plan…' : 'Starting…'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{starting.objective}</p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Reading the folder and breaking this into checkable steps. Takes a moment.
        </p>
      </div>
    );
  }

  if (!hasGoal) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <GoalPanel conversationId={chatId} workingDir={folder} surfaceId={surfaceId} />
    </div>
  );
}
