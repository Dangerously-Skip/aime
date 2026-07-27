'use client';

import { useEffect } from 'react';
import { onStreamAborted } from '@/lib/stream-registry';

/**
 * Close the surface's Run when its stream is aborted.
 *
 * `runRecorder.succeed()` and `.fail()` are called only from the stream's
 * `onDone` / `onError`, and an aborted fetch reaches neither. So pressing Stop,
 * switching conversation, or a stuck-tool cancel left the Run sitting in
 * `running` for ever — and a Run that never ends is precisely what the run log
 * exists to prevent: "a widget that had failed forty times looked identical to
 * one that had simply never run."
 *
 * Lives in a hook rather than four copies of the same effect because the two
 * decisions in it — a timeout is not a cancel, and another surface's abort is not
 * ours — are worth stating once and testing once.
 */

type RunFinish = (
  status: 'succeeded' | 'failed' | 'cancelled' | 'timeout',
  error?: string,
) => void;

/** What a timed-out Run records, so the reason survives into the run log. */
export const TIMED_OUT_RUN_ERROR = 'The stream stopped responding and was aborted.';

/**
 * @param closeRun  the surface's `runRecorder.finish` (stable across renders).
 * @param ownsChat  whether an aborted chatId belongs to this surface. Aborts are
 *   broadcast to every listener, so without this a Stop in Cowork would also
 *   close Chat's live Run. Must be stable — wrap it in `useCallback`.
 */
export function useCloseRunOnAbort(closeRun: RunFinish, ownsChat: (chatId: string) => boolean): void {
  useEffect(
    () =>
      onStreamAborted(({ chatId, reason }) => {
        if (!ownsChat(chatId)) return;
        // A timeout may simply have needed longer; a cancel was a decision.
        // Collapsing them makes "is this automation broken?" unanswerable.
        if (reason === 'timeout') closeRun('timeout', TIMED_OUT_RUN_ERROR);
        else closeRun('cancelled');
      }),
    [closeRun, ownsChat],
  );
}
