import { isStorageGateOpen } from '@/lib/gated-storage';
import { handleMemoryExtractEvent } from './handle-extract-event';
import type { PendingMemory } from './types';

/**
 * The renderer's half of the pending-memory queue (server half:
 * `pending-extractions.ts`): fetch what the server extracted, store it, then
 * acknowledge it by id.
 *
 * Called on app start (`usePendingMemoryPull`) and after every turn's `done`
 * (`useSSEStream`). The second pull asks the server to WAIT for that turn's
 * extraction, which only starts once the stream has closed — so a memory shows
 * up seconds after the reply rather than on the next message. This replaced
 * delivery on the next turn's stream, which lost everything if the app quit
 * first and showed nothing until you spoke again.
 */

const PENDING_URL = '/api/memory/pending';

/** How long the post-turn pull lets the server hold for that turn's extraction. */
export const AFTER_TURN_WAIT_MS = 25_000;

/**
 * Ids already stored this session. Two pulls can overlap (start-up and a turn
 * ending, or two turns), and both receive whatever neither has acknowledged
 * yet. The id check in the handler catches most of that; this also catches an
 * item that was MERGED into an existing memory, whose id is therefore not in
 * the store — re-handling it would bump that memory's confidence again.
 */
const handled = new Set<string>();

function isPendingMemory(v: unknown): v is PendingMemory {
  const m = v as Partial<PendingMemory> | null;
  return Boolean(
    m &&
      typeof m.id === 'string' &&
      typeof m.chatId === 'string' &&
      typeof m.content === 'string' &&
      typeof m.category === 'string' &&
      Array.isArray(m.tags) &&
      typeof m.confidence === 'number',
  );
}

/**
 * Pull, store, acknowledge. Resolves to the number of items acknowledged; never
 * rejects — this is background work and a failure just leaves the items queued
 * for the next pull.
 */
export async function pullPendingMemories(opts: { waitMs?: number } = {}): Promise<number> {
  /*
   * Not before the persisted stores have loaded. A memory added then would be
   * overwritten by the rehydrate (and its write dropped by the closed storage
   * gate) — and we would already have told the server to forget it.
   */
  if (!isStorageGateOpen()) return 0;
  try {
    const wait = Math.max(0, Math.floor(opts.waitMs ?? 0));
    const res = await fetch(wait > 0 ? `${PENDING_URL}?wait=${wait}` : PENDING_URL, { cache: 'no-store' });
    if (!res.ok) return 0;
    const body = (await res.json()) as { items?: unknown };
    const items = Array.isArray(body?.items) ? body.items.filter(isPendingMemory) : [];
    if (items.length === 0) return 0;

    const byChat = new Map<string, PendingMemory[]>();
    for (const item of items) {
      if (handled.has(item.id)) continue;
      byChat.set(item.chatId, [...(byChat.get(item.chatId) ?? []), item]);
    }
    const stored: string[] = items.filter((i) => handled.has(i.id)).map((i) => i.id);
    for (const [chatId, group] of byChat) {
      try {
        handleMemoryExtractEvent(group, chatId);
        for (const item of group) {
          handled.add(item.id);
          stored.push(item.id);
        }
      } catch (err) {
        // Left unacknowledged, so the next pull retries this group.
        console.error('[MEMORY] Could not store pending memories:', err);
      }
    }
    if (stored.length === 0) return 0;

    const ack = await fetch(PENDING_URL, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: stored }),
    });
    return ack.ok ? stored.length : 0;
  } catch (err) {
    console.warn('[MEMORY] Pending-memory pull failed:', err);
    return 0;
  }
}

/** Test seam. */
export function resetPendingPull(): void {
  handled.clear();
}
