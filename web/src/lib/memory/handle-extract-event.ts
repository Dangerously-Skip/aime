/*
 * Static imports. These were lazy `require()`s, added against a Turbopack TDZ
 * cycle when this module was reached from the surfaces. Nothing these stores
 * import reaches back here (checked when the pull replaced the stream event),
 * and the `require`s had a cost: vitest does not resolve `@/` inside one, so
 * this handler could not be tested against the real store — and never was.
 */
import { useMemoryStore } from '@/stores/memory-store';
import { useConversationStore, type Conversation } from '@/stores/conversation-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Memory, MemoryCategory } from './types';

export interface ExtractedMemoryEvent {
  /**
   * Stable id from the server's pending queue. Becomes the stored memory's id,
   * so the same item delivered twice is stored once. Content dedup alone does
   * not give that: an exact duplicate SUPERSEDES the old record with a new one,
   * so every re-delivery would add another row.
   */
  id?: string;
  content: string;
  category: string;
  tags: string[];
  confidence: number;
}

/**
 * Store memories extracted from `conversationId`'s turn.
 * Checks the auto-extraction setting before storing.
 */
export function handleMemoryExtractEvent(
  extracted: ExtractedMemoryEvent[],
  conversationId: string,
): void {
  if (!Array.isArray(extracted) || extracted.length === 0) return;

  const autoExtractEnabled = useSettingsStore.getState().autoExtractMemories;
  if (autoExtractEnabled === false) return;

  const conv = useConversationStore.getState().conversations.find(
    (c: Conversation) => c.id === conversationId
  );
  const projectId = conv?.projectId || null;

  for (const mem of extracted) {
    const store = useMemoryStore.getState();
    if (mem.id && store.memories.some((m: Memory) => m.id === mem.id)) continue;
    store.addMemoryWithDedup({
      id: mem.id || crypto.randomUUID(),
      content: mem.content,
      category: mem.category as MemoryCategory,
      scope: projectId ? 'project' : 'global',
      projectId,
      tags: mem.tags || [],
      confidence: mem.confidence || 0.7,
      accessCount: 0,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      supersededBy: null,
      source: 'auto',
      updatedCount: 0,
    });
  }
}
