import { useMemoryStore } from '@/stores/memory-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { MemoryCategory } from './types';

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

  const autoExtractEnabled = useSettingsStore.getState().autoExtractMemories;
  if (autoExtractEnabled === false) return;

  const conv = useConversationStore.getState().conversations.find(
    (c) => c.id === conversationId
  );
  const projectId = conv?.projectId || null;

  for (const mem of extracted) {
    useMemoryStore.getState().addMemoryWithDedup({
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
    });
  }
}
