'use client';

import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useCodeStore } from '@/stores/code-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useProjectStore } from '@/stores/project-store';

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
 */

type SurfaceStore = {
  getState: () => { currentChatId: string | null; setCurrentChat: (id: string) => void };
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
 * It also becomes the ACTIVE conversation. Every conversation surface re-syncs
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
