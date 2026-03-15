import { useMemoryStore } from '@/stores/memory-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { Message } from '@/stores/chat-store';
import type { Memory } from './types';

const MIN_MESSAGES_FOR_SUMMARY = 4; // At least 2 user + 2 assistant turns
const MAX_CONTENT_FOR_SUMMARY = 6000; // Truncate conversation content to fit in a Haiku call

/**
 * Generate a brief episodic summary from conversation messages.
 * Uses a simple local extraction (no LLM call) to keep it fast and offline-capable.
 * Falls back to extracting key topics from the conversation.
 */
function extractSummary(messages: Message[]): string {
  // Collect user messages to understand what was discussed
  const userMessages = messages
    .filter((m) => m.role === 'user' && m.content)
    .map((m) => m.content);

  const assistantMessages = messages
    .filter((m) => m.role === 'assistant' && m.content && m.content.length > 20)
    .map((m) => m.content);

  if (userMessages.length === 0) return '';

  // Build a concise summary from the user's queries and key assistant responses
  const topics = userMessages.map((msg) => {
    // Truncate long messages to first sentence or 120 chars
    const firstSentence = msg.split(/[.!?]\s/)[0];
    return firstSentence.length > 120 ? firstSentence.substring(0, 120) + '...' : firstSentence;
  });

  // Check if any files were written/edited (look for tool calls in assistant messages)
  const hasToolWork = messages.some(
    (m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
  );

  const parts = [`Discussed: ${topics.join('; ')}`];
  if (hasToolWork) {
    const toolNames = new Set<string>();
    messages.forEach((m) => {
      m.toolCalls?.forEach((tc) => toolNames.add(tc.name));
    });
    if (toolNames.size > 0) {
      parts.push(`Tools used: ${[...toolNames].join(', ')}`);
    }
  }

  const summary = parts.join('. ');
  return summary.length > MAX_CONTENT_FOR_SUMMARY
    ? summary.substring(0, MAX_CONTENT_FOR_SUMMARY) + '...'
    : summary;
}

/**
 * Summarize a conversation and store as an episodic memory.
 * Called when the user switches away from a conversation that has enough messages.
 */
export function summarizeConversation(
  conversationId: string,
  messages: Message[],
): void {
  // Need a minimum number of messages to be worth summarizing
  if (messages.length < MIN_MESSAGES_FOR_SUMMARY) return;

  // Don't re-summarize if we already have an episodic memory for this conversation
  const existingMemories = useMemoryStore.getState().memories;
  const alreadySummarized = existingMemories.some(
    (m) =>
      m.category === 'episodic' &&
      !m.supersededBy &&
      m.tags.includes(`conv:${conversationId}`)
  );
  if (alreadySummarized) return;

  const summary = extractSummary(messages);
  if (!summary) return;

  // Determine project scope
  const conv = useConversationStore.getState().conversations.find(
    (c) => c.id === conversationId
  );
  const projectId = conv?.projectId || null;

  const memory: Memory = {
    id: crypto.randomUUID(),
    content: summary,
    category: 'episodic',
    scope: projectId ? 'project' : 'global',
    projectId,
    tags: [`conv:${conversationId}`, `surface:${conv?.surface || 'unknown'}`],
    confidence: 0.9,
    accessCount: 0,
    lastAccessedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    supersededBy: null,
    source: 'auto',
    updatedCount: 0,
  };

  useMemoryStore.getState().addMemory(memory);
}
