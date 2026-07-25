'use client';

import { useCallback, useRef } from 'react';
import { useRunStore } from '@/stores/run-store';
import { costFromStreamUsage } from '@/lib/runs/runs';
import type { RunTrigger } from '@/lib/runs/types';
import type { StreamUsage } from './use-sse-stream';

/**
 * Records a Run around a streamed turn, so every execution leaves a durable
 * trace with its cost attached. This is the seam that makes Cockpit's
 * "scheduled runs and their outcomes" possible, and it is deliberately the same
 * substrate Clawish uses — a chat turn and a 3am cron fire produce the same
 * record, differing only in `trigger`.
 *
 * Usage from a surface:
 *   const rec = useRunRecorder('chat');
 *   rec.begin({ trigger: 'chat', model });   // before sendMessage
 *   ...
 *   onUsage: rec.onUsage,                    // captures cost when it arrives
 *   onDone:  () => rec.succeed(),
 *   onError: (e) => rec.fail(e),
 *
 * Failure to record must never break the turn it measures, so every method is
 * safe to call out of order or twice — `endRun` in the store is a no-op for an
 * unknown or already-terminal run.
 */
export function useRunRecorder(surfaceId: string) {
  const beginRun = useRunStore((s) => s.beginRun);
  const endRun = useRunStore((s) => s.endRun);
  const activeIdRef = useRef<string | null>(null);
  // Usage arrives on the `done` event, which may land before or in the same
  // tick as our completion callback — stash it rather than racing for it.
  const usageRef = useRef<StreamUsage | null>(null);

  const begin = useCallback(
    (params: { trigger: RunTrigger; goalId?: string | null; model?: string }) => {
      const id = globalThis.crypto.randomUUID();
      activeIdRef.current = id;
      usageRef.current = null;
      beginRun({
        id,
        now: Date.now(),
        goalId: params.goalId ?? null,
        trigger: params.trigger,
        surfaceId,
        model: params.model,
      });
      return id;
    },
    [beginRun, surfaceId],
  );

  const onUsage = useCallback((usage: StreamUsage) => {
    usageRef.current = usage;
  }, []);

  const finish = useCallback(
    (status: 'succeeded' | 'failed' | 'cancelled' | 'timeout', error?: string) => {
      const id = activeIdRef.current;
      if (!id) return;
      activeIdRef.current = null;
      const usage = usageRef.current;
      endRun(id, {
        now: Date.now(),
        status,
        error,
        cost: costFromStreamUsage(usage ?? undefined),
        toolCalls: usage?.toolCallCount,
      });
    },
    [endRun],
  );

  const succeed = useCallback(() => finish('succeeded'), [finish]);
  const fail = useCallback((error?: string) => finish('failed', error), [finish]);
  const cancel = useCallback(() => finish('cancelled'), [finish]);

  return { begin, onUsage, succeed, fail, cancel, finish, activeRunId: activeIdRef };
}
