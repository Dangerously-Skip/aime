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
 *   rec.begin({ trigger: 'chat', model, chatId });   // before sendMessage
 *   ...
 *   onUsage: rec.onUsage,                    // (usage, chatId) — captures cost
 *   onDone:  (chatId) => rec.succeed(chatId),
 *   onError: (e, chatId) => rec.fail(e.message, chatId),
 *
 * Failure to record must never break the turn it measures, so every method is
 * safe to call out of order or twice — `endRun` in the store is a no-op for an
 * unknown or already-terminal run.
 *
 * ONE RUN PER CONVERSATION, not one per surface. The recorder used to hold a
 * single "active run", which was right while a surface streamed one turn at a
 * time. Once conversations ran concurrently, starting a turn in chat B
 * overwrote A's run id: A's run sat in `running` for ever, and B's could be
 * closed by A finishing. Every method takes the chatId the stream was started
 * for — `useSSEStream` already hands it to every callback — and a caller that
 * names none keeps the old single slot.
 */

/** The slot for a caller that names no conversation. */
const DEFAULT_SLOT = '';

/** One turn in flight: its Run id, and what arrived for it before it ended. */
interface RunSlot {
  id: string;
  /**
   * Usage arrives on the `done` event, which may land before or in the same
   * tick as the completion callback — stashed rather than raced for.
   */
  usage: StreamUsage | null;
  /**
   * A failure the stream REPORTED (an SSE `error`, or a `done` flagged as an
   * error) without throwing. The stream still ends cleanly and reaches `onDone`,
   * so without this `succeed()` recorded a failed turn as a success.
   */
  failure: string | null;
}

export function useRunRecorder(surfaceId: string) {
  const beginRun = useRunStore((s) => s.beginRun);
  const endRun = useRunStore((s) => s.endRun);
  const slotsRef = useRef<Map<string, RunSlot>>(new Map());

  /**
   * The run a call is about: this conversation's, or — when the turn was begun
   * without naming one — the single slot.
   */
  const slotFor = useCallback((chatId: string | undefined): [string, RunSlot] | null => {
    const slots = slotsRef.current;
    if (chatId !== undefined) {
      const own = slots.get(chatId);
      if (own) return [chatId, own];
    }
    const single = slots.get(DEFAULT_SLOT);
    return single ? [DEFAULT_SLOT, single] : null;
  }, []);

  const begin = useCallback(
    (params: { trigger: RunTrigger; goalId?: string | null; model?: string; chatId?: string }) => {
      const id = globalThis.crypto.randomUUID();
      slotsRef.current.set(params.chatId ?? DEFAULT_SLOT, { id, usage: null, failure: null });
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

  const onUsage = useCallback(
    (usage: StreamUsage, chatId?: string) => {
      const found = slotFor(chatId);
      if (found) found[1].usage = usage;
    },
    [slotFor],
  );

  const finish = useCallback(
    (status: 'succeeded' | 'failed' | 'cancelled' | 'timeout', error?: string, chatId?: string) => {
      const found = slotFor(chatId);
      if (!found) return;
      const [key, { id, usage }] = found;
      slotsRef.current.delete(key);
      endRun(id, {
        now: Date.now(),
        status,
        error,
        cost: costFromStreamUsage(usage ?? undefined),
        toolCalls: usage?.toolCallCount,
      });

      // Persist the completed record to the durable JSONL log. Fire-and-forget
      // and failure-swallowing on purpose: the store already holds it for live
      // display, and recording a run must never be able to fail the turn it
      // describes. Written once, on completion, so the log stays append-only.
      const finished = useRunStore.getState().getRun(id);
      if (finished) {
        void fetch('/api/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ run: finished }),
        }).catch(() => {});
      }
    },
    [endRun, slotFor],
  );

  /** Note a reported failure; the turn's eventual `succeed()` records it. */
  const noteFailure = useCallback(
    (message: string, chatId?: string) => {
      const found = slotFor(chatId);
      // The first failure is the cause; later ones are usually its echo.
      if (found) found[1].failure ??= message;
    },
    [slotFor],
  );

  const succeed = useCallback(
    (chatId?: string) => {
      const failure = slotFor(chatId)?.[1].failure;
      if (failure) finish('failed', failure, chatId);
      else finish('succeeded', undefined, chatId);
    },
    [finish, slotFor],
  );
  const fail = useCallback((error?: string, chatId?: string) => finish('failed', error, chatId), [finish]);
  const cancel = useCallback((chatId?: string) => finish('cancelled', undefined, chatId), [finish]);

  return { begin, onUsage, noteFailure, succeed, fail, cancel, finish };
}
