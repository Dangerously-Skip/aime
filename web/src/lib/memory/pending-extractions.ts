/**
 * Memories extracted after a turn's stream has closed, waiting for the next
 * turn in the same conversation to carry them to the client.
 *
 * Extraction used to run BEFORE `done`: a full model call, on the turn's model,
 * holding the user's composer locked for as long as it took — and still running
 * after the client had gone. It now runs after the stream closes, so its result
 * has no stream to ride on; the memory store lives in the renderer, so the next
 * turn's stream delivers it as the ordinary `memory_extract` event.
 *
 * In memory and bounded. Losing a stash (a restart, a conversation never
 * resumed) costs a background nicety, never a turn.
 */

export interface ExtractedMemoryPayload {
  content: string;
  category: string;
  tags: string[];
  confidence: number;
}

const LIMIT = 64;
const pending = new Map<string, ExtractedMemoryPayload[]>();

/** Hold memories for `chatId`, appending to any not yet delivered. */
export function stashExtractedMemories(chatId: string, memories: ExtractedMemoryPayload[]): void {
  if (!chatId || memories.length === 0) return;
  const existing = pending.get(chatId) ?? [];
  pending.delete(chatId); // re-insert so the map stays ordered by recency
  pending.set(chatId, [...existing, ...memories]);
  while (pending.size > LIMIT) {
    const oldest = pending.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/** Take (and forget) whatever is waiting for `chatId`. */
export function takeExtractedMemories(chatId: string | null | undefined): ExtractedMemoryPayload[] {
  if (!chatId) return [];
  const out = pending.get(chatId) ?? [];
  pending.delete(chatId);
  return out;
}

/** Test seam. */
export function resetPendingExtractions(): void {
  pending.clear();
}
