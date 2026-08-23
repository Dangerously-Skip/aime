'use client';

import { useEffect, useRef } from 'react';
import { useContextBusStore } from '@/stores/context-bus-store';

/**
 * Run a scheduled prompt on the surface it was addressed to.
 *
 * WHAT WAS MISSING. A due cron job published to the context bus and switched
 * surface, and the comment at that call site said "the surface named by the job
 * owns actually running it" — but nothing subscribed. Code and Cowork fold
 * unconsumed bus events into the NEXT HUMAN MESSAGE; chat, browser and assistant
 * never read the bus at all. So a job fired, the surface changed, and the work
 * never happened. The e2e proved the switch and `lastRun`, which is exactly the
 * half that worked.
 *
 * WHY A HOOK AND NOT AN EXECUTOR. The objection to running it centrally was
 * sound: a scheduler with its own send path would be a fourth place that starts
 * a turn, and this codebase has already paid for having four of anything. So
 * this starts no turn. It hands the prompt to the surface's OWN submit
 * function — the same one the composer calls — which keeps one send path per
 * surface and means a scheduled run goes through every gate a typed one does.
 *
 * CONSUMED BEFORE SUBMITTING, deliberately. A submit that throws, or a surface
 * that re-renders mid-flight, must not run the job twice: re-reading a bus event
 * is cheap and a duplicate agent turn costs money and can act on the world.
 * Losing a scheduled run is recoverable — it fires again next interval — and
 * doubling one may not be.
 */
export function useScheduledPrompt(
  surfaceId: string,
  submit: (prompt: string) => void | Promise<void>,
): void {
  /*
   * Held in a ref so this effect subscribes once. `submit` is a new function on
   * most renders, and re-subscribing per render is how a listener ends up firing
   * a job once per accumulated subscription.
   */
  const submitRef = useRef(submit);
  /*
   * Assigned in an effect, not during render — React forbids touching a ref
   * while rendering, and under concurrent rendering a render that is thrown away
   * would otherwise leave the ref pointing at a submit that never mounted.
   *
   * Declared BEFORE the subscription effect so it runs first: effects fire in
   * declaration order, so the ref is current by the time a job is dispatched.
   */
  useEffect(() => {
    submitRef.current = submit;
  });

  const events = useContextBusStore((s) => s.events);

  useEffect(() => {
    if (!surfaceId) return;
    const due = events.find(
      (e) =>
        !e.consumed &&
        e.targetSurface === surfaceId &&
        typeof (e.payload as { prompt?: unknown } | undefined)?.prompt === 'string' &&
        typeof (e.payload as { cronJobId?: unknown } | undefined)?.cronJobId === 'string',
    );
    if (!due) return;

    const prompt = (due.payload as { prompt: string }).prompt;

    // Consume FIRST — see the note above about doubling a run.
    useContextBusStore.getState().consume(due.id);

    void Promise.resolve(submitRef.current(prompt)).catch((err) => {
      console.error(`[cron] ${surfaceId} failed to run a scheduled prompt:`, err);
    });
  }, [events, surfaceId]);
}
