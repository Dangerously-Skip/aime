'use client';

import { useEffect, useState } from 'react';
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
}: {
  chatId: string;
  folder: string | null;
  surfaceId: 'cowork' | 'code';
}) {
  const [hasGoal, setHasGoal] = useState(false);

  useEffect(() => {
    if (!folder || !chatId) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(
          `/api/harness?conversationId=${encodeURIComponent(chatId)}&workingDir=${encodeURIComponent(folder)}`,
        );
        if (!res.ok || cancelled) return;
        const s = (await res.json()) as { goal?: unknown };
        if (!cancelled) setHasGoal(!!s.goal);
      } catch {
        // A failed poll is not worth surfacing; the next one is 3s away.
      }
    };
    void check();
    const id = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chatId, folder]);

  if (!folder || !hasGoal) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/50">
      <GoalPanel conversationId={chatId} workingDir={folder} surfaceId={surfaceId} />
    </div>
  );
}
