'use client';

import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useCodeStore } from '@/stores/code-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useProjectStore } from '@/stores/project-store';
import { streamRegistry } from '@/lib/stream-registry';

/**
 * A fresh conversation for a scheduled job to run in.
 *
 * WHY. A due job was handed to the surface's submit, which sends into whatever
 * conversation that surface has open. So a job created under a project ran in
 * some unrelated chat, with none of the project's instructions or knowledge —
 * those come from the conversation's `projectId` — and every job appended its
 * turn to the middle of whatever the user was last doing there.
 *
 * Now each firing gets its own conversation, filed under the job's project when
 * it has one, and the surface is pointed at it before the submit runs. The
 * surface's own send path does the rest, unchanged: its project context is
 * derived from the conversation, so the instructions come along by themselves.
 *
 * Surfaces without conversations (Assistant, Browser) run the job as before.
 *
 * AND THEN THE VIEW IS HANDED BACK. The switch exists only so the surface's
 * submit binds to the job's conversation; once its stream has started, the
 * stream's callbacks are pinned to that conversation (use-sse-stream snapshots
 * them at send time), so the user's own conversation is restored and the job
 * carries on in the background. Without that, a job firing on the surface you
 * were looking at replaced your conversation with its own, mid-sentence.
 */

type SurfaceStore = {
  getState: () => { currentChatId: string | null; setCurrentChat: (id: string | null) => void };
};

const SURFACES: Record<string, SurfaceStore> = {
  chat: useChatStore as unknown as SurfaceStore,
  cowork: useCoworkStore as unknown as SurfaceStore,
  code: useCodeStore as unknown as SurfaceStore,
};

/** Does this surface keep conversations a job can be given? */
export function hasJobConversations(surfaceId: string): boolean {
  return surfaceId in SURFACES;
}

/** The conversation a surface currently sends into. */
export function currentChatOf(surfaceId: string): string | null {
  return SURFACES[surfaceId]?.getState().currentChatId ?? null;
}

const TITLE_MAX = 50;

/**
 * Create the job's conversation and make it the one the surface sends into.
 * Returns its id, or null for a surface without conversations.
 *
 * It also becomes the ACTIVE conversation — briefly: `handBackView` restores
 * the user's once the job's turn is in flight. Every conversation surface re-syncs
 * its current chat from the active one whenever the conversation list changes —
 * and creating this one changes the list — so pointing only the surface at it
 * would be undone on the next render. The active SURFACE is not touched: a job
 * for Chat that fires while you are in Code stays in the background.
 */
export function openJobConversation(
  surfaceId: string,
  job: { prompt: string; projectId?: string | null },
): string | null {
  const store = SURFACES[surfaceId];
  if (!store) return null;

  const id = globalThis.crypto.randomUUID();
  const now = Date.now();
  const text = job.prompt.trim();
  useConversationStore.getState().addConversation({
    id,
    title: `Scheduled: ${text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text}`,
    surface: surfaceId,
    lastMessage: '',
    createdAt: now,
    updatedAt: now,
    projectId: job.projectId ?? null,
  });
  if (job.projectId) useProjectStore.getState().addConversationToProject(job.projectId, surfaceId, id);
  useConversationStore.getState().setActiveConversation(id);
  store.getState().setCurrentChat(id);
  return id;
}

/** What the user was looking at before a job borrowed the surface. */
export interface ViewSnapshot {
  activeId: string | null;
  currentChat: string | null;
}

export function snapshotView(surfaceId: string): ViewSnapshot {
  return {
    activeId: useConversationStore.getState().activeId,
    currentChat: currentChatOf(surfaceId),
  };
}

/**
 * Put the user's conversation back — unless they have already moved off the
 * job's conversation themselves, in which case their choice stands.
 */
export function restoreView(surfaceId: string, jobConversationId: string, prev: ViewSnapshot): void {
  const store = SURFACES[surfaceId];
  if (!store) return;
  if (useConversationStore.getState().activeId !== jobConversationId) return;
  if (store.getState().currentChatId === jobConversationId) store.getState().setCurrentChat(prev.currentChat);
  useConversationStore.getState().setActiveConversation(prev.activeId);
}

/** How often to check whether the job's stream has started. */
const HANDBACK_POLL_MS = 25;
/**
 * Hand the view back after this long regardless. A surface does some work
 * before it sends (memory lookup, attachments); a submit that never streams at
 * all (a slash command, a guard) settles, which also hands back.
 */
const HANDBACK_DEADLINE_MS = 30_000;

/**
 * Restore the user's view as soon as the job's turn is in flight — i.e. its
 * stream is registered, which happens in the same tick its callbacks are
 * pinned — or its submit has settled, or the deadline passes.
 *
 * Deliberately NOT tied to a React effect's lifetime: the effect that ran the
 * job re-runs when the bus changes, and a hand-back cancelled by that would
 * leave the user in the job's conversation — the bug this exists to fix.
 */
export function handBackView(
  surfaceId: string,
  jobConversationId: string,
  prev: ViewSnapshot,
  isSettled: () => boolean,
  opts: { pollMs?: number; deadlineMs?: number } = {},
): void {
  const deadline = Date.now() + (opts.deadlineMs ?? HANDBACK_DEADLINE_MS);
  const poll = () => {
    if (streamRegistry.has(jobConversationId) || isSettled() || Date.now() >= deadline) {
      restoreView(surfaceId, jobConversationId, prev);
      return;
    }
    setTimeout(poll, opts.pollMs ?? HANDBACK_POLL_MS);
  };
  poll();
}
