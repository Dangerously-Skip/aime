'use client';

import { useEffect, useRef } from 'react';
import type { Message } from '@/stores/chat-store';

/**
 * Let a goal run narrate itself into the chat transcript.
 *
 * WHY. Everything a run did lived in a side panel, while the centre of the
 * screen — the transcript, where the eye actually goes — showed an unrelated
 * conversation or nothing at all. A run completed two tasks, changed real code
 * and reported "$0.27 of $2.00" in green, and still read as "I'm not sure it
 * even ran". In a chat app the transcript IS the interface; a feature that
 * happens somewhere else has not happened.
 *
 * WHAT IT POSTS. One line when the run starts, one per session as it lands, one
 * when it stops. Deliberately terse: this is a running account, not a log dump,
 * and the panel is still where the plan and the spend live.
 *
 * IDEMPOTENT BY KEY. It polls, so the same event is seen many times. Each posted
 * line is remembered by a key derived from the event, and the set survives
 * re-renders — otherwise a 3s poll would append the same line twenty times a
 * minute.
 */

export interface TranscriptStatus {
  running: boolean;
  /**
   * Which run these events belong to.
   *
   * Session indexes and task ids restart at 1 and t-001 for every new goal, so
   * keys built from them alone collide across runs — a second goal in the same
   * chat narrated nothing, because every line looked already-posted.
   */
  runIndex?: number | null;
  goal: { objective: string } | null;
  ledger: { tasks: { id: string; title: string; status: string }[] } | null;
  run: { sessions: number; spentUsd: number } | null;
  decision: { stop: boolean; reason?: string; detail?: string } | null;
  events: { type: string; sessionIndex?: number; taskId?: string; detail?: string }[];
  question?: { id: string; question: string } | null;
}

function line(content: string): Message {
  return {
    id: `goal_${Math.random().toString(36).slice(2)}`,
    role: 'assistant',
    content,
    timestamp: Date.now(),
  };
}

/** What the transcript should say, given a status — and a key to dedupe on. */
export function transcriptLines(
  s: TranscriptStatus,
): { key: string; content: string }[] {
  const out: { key: string; content: string }[] = [];
  if (!s.goal) return out;
  const run = `r${s.runIndex ?? 0}`;

  const tasks = s.ledger?.tasks ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t.title]));

  for (const e of s.events) {
    if (e.type === 'session-start' && e.sessionIndex) {
      out.push({
        key: `${run}:start:${e.sessionIndex}`,
        content: `**Session ${e.sessionIndex}** — working on _${byId.get(e.taskId ?? '') ?? e.taskId}_`,
      });
    }
    if (e.type === 'verify-end' && e.sessionIndex) {
      const passed = e.detail === 'passed';
      out.push({
        key: `${run}:verify:${e.sessionIndex}:${e.taskId}`,
        content: passed
          ? `✓ Checked and passed — _${byId.get(e.taskId ?? '') ?? e.taskId}_`
          : `✗ Checked and rejected — ${e.detail ?? 'no reason given'}`,
      });
    }
    if (e.type === 'tamper') {
      out.push({ key: `${run}:tamper:${e.sessionIndex}`, content: `⚠ Rejected a plan edit — ${e.detail}` });
    }
    if (e.type === 'revised') {
      out.push({ key: `${run}:revised:${e.sessionIndex}`, content: `Plan changed — ${e.detail}` });
    }
  }

  if (s.question) {
    out.push({
      key: `${run}:question:${s.question.id}`,
      // Not "in the Goal panel" any more — the answer control sits directly
      // above the composer, which is where the reader already is.
      content: `**It needs a decision from you.** ${s.question.question}\n\nAnswer just above the composer and it carries on.`,
    });
  }

  if (!s.running && s.decision?.stop) {
    const spend = s.run ? ` · $${s.run.spentUsd.toFixed(2)} over ${s.run.sessions} session${s.run.sessions === 1 ? '' : 's'}` : '';
    out.push({
      key: `${run}:stopped:${s.decision.reason}:${s.run?.sessions ?? 0}`,
      /*
       * THE RUN IS OVER, SAID TO THE MODEL AS WELL AS TO THE USER.
       *
       * These lines are posted into the chat as assistant turns, so they become
       * the history of every LATER turn in this conversation. After a run
       * stopped, the model read "Session 1 — working on…", "Checked and passed"
       * and carried straight on in the same voice: "Now let me verify t-002",
       * "t-002 verified" — with no verifier, no ledger write, and no run. The
       * plan never moved, and the user reasonably read the panel as broken.
       *
       * A false claim of verification is the worst failure this system has,
       * because verification is the only reason to trust any of it. The fix is
       * cheap and lands in the one place that causes the confusion: the same
       * history now says the harness is not running and cannot be spoken for.
       */
      content:
        `**Goal ${s.decision.reason === 'complete' ? 'complete' : 'stopped'}** — ${s.decision.detail ?? ''}${spend}` +
        `\n\n_The goal run has ended. Anything from here is an ordinary chat turn: there is no ` +
        `verifier running, tasks cannot be marked passed, and the plan will not change. Do not ` +
        `narrate sessions or claim a task is verified — say what you actually did, and toggle ` +
        `**Pursue goal** to start another run._`,
    });
  }

  return out;
}

export function useGoalTranscript(
  chatId: string,
  folder: string | null,
  addMessage: (chatId: string, message: Message) => void,
): void {
  // Keys already posted. A ref, not state: appending must not re-render, and the
  // set has to survive the poll it was populated by.
  const seen = useRef<Set<string>>(new Set());
  const lastChat = useRef<string>('');

  useEffect(() => {
    if (!chatId || !folder) return;
    // A different conversation is a different transcript.
    if (lastChat.current !== chatId) {
      seen.current = new Set();
      lastChat.current = chatId;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/harness?conversationId=${encodeURIComponent(chatId)}&workingDir=${encodeURIComponent(folder)}`,
        );
        if (!res.ok || cancelled) return;
        const status = (await res.json()) as TranscriptStatus;
        if (cancelled) return;
        for (const l of transcriptLines(status)) {
          if (seen.current.has(l.key)) continue;
          seen.current.add(l.key);
          addMessage(chatId, line(l.content));
        }
      } catch {
        // A failed poll is not worth a message; the next one is 3s away.
      }
    };

    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chatId, folder, addMessage]);
}
