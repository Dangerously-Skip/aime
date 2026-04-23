// Lazy imports to avoid circular dependencies with Turbopack's module evaluation
const getMemoryStore = () => require('@/stores/memory-store').useMemoryStore;
const getConversationStore = () => require('@/stores/conversation-store').useConversationStore;
const getSettingsStore = () => require('@/stores/settings-store').useSettingsStore;
import type { MemoryCategory } from './types';
import type { Conversation } from '@/stores/conversation-store';

interface ExtractedMemoryEvent {
  content: string;
  category: string;
  tags: string[];
  confidence: number;
}

/**
 * Handle a memory_extract SSE event by storing extracted memories.
 * Checks auto-extraction setting before storing.
 */
export function handleMemoryExtractEvent(
  extracted: ExtractedMemoryEvent[],
  conversationId: string,
): void {
  if (!Array.isArray(extracted) || extracted.length === 0) return;

  const autoExtractEnabled = getSettingsStore().getState().autoExtractMemories;
  if (autoExtractEnabled === false) return;

  const conv = getConversationStore().getState().conversations.find(
    (c: Conversation) => c.id === conversationId
  );
  const projectId = conv?.projectId || null;

  for (const mem of extracted) {
    getMemoryStore().getState().addMemoryWithDedup({
      id: crypto.randomUUID(),
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
