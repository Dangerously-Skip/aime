import { useProjectStore, type Project, type ProjectArtifact } from '@/stores/project-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';

/**
 * Get a surface-specific store for reading messages.
 */
function getMessagesForConversation(conversationId: string, surface: string): Array<{ role: string; content: string }> {
  switch (surface) {
    case 'chat':
      return useChatStore.getState().messages[conversationId] ?? [];
    case 'cowork':
      return useCoworkStore.getState().messages[conversationId] ?? [];
    default:
      return [];
  }
}

/**
 * Generate a brief summary of a conversation by taking the first user message
 * and first assistant response (lightweight, no API call).
 */
function summarizeConversation(messages: Array<{ role: string; content: string }>): string {
  const userMsgs = messages.filter((m) => m.role === 'user' && m.content);
  const assistMsgs = messages.filter((m) => m.role === 'assistant' && m.content);

  const parts: string[] = [];
  if (userMsgs.length > 0) {
    parts.push(`Topic: ${userMsgs[0].content.substring(0, 100)}`);
  }
  if (assistMsgs.length > 0) {
    const lastAssist = assistMsgs[assistMsgs.length - 1].content;
    parts.push(`Latest: ${lastAssist.substring(0, 200)}`);
  }
  if (userMsgs.length > 1) {
    parts.push(`(${userMsgs.length} messages total)`);
  }

  return parts.join('. ');
}

/**
 * Build cross-surface project context for injection into system prompts.
 *
 * Gathers summaries from conversations on OTHER surfaces (up to 5 most recent),
 * lists all artifacts, and returns formatted XML string.
 */
export function buildProjectContext(
  project: Project,
  currentSurface: string,
  currentConversationId: string,
): string {
  const parts: string[] = [];

  // Cross-surface conversation summaries
  const summaries: string[] = [];
  const conversations = useConversationStore.getState().conversations;

  for (const [surface, convIds] of Object.entries(project.conversationIds)) {
    if (surface === currentSurface) continue; // Skip current surface
    // Get the most recent conversations from other surfaces
    const recentConvIds = convIds.slice(-3);
    for (const convId of recentConvIds) {
      if (convId === currentConversationId) continue;
      const conv = conversations.find((c) => c.id === convId);
      if (!conv) continue;
      const messages = getMessagesForConversation(convId, surface);
      if (messages.length === 0) continue;
      const summary = summarizeConversation(messages);
      if (summary) {
        summaries.push(`[From ${surface.charAt(0).toUpperCase() + surface.slice(1)}]: ${summary}`);
      }
    }
  }

  if (summaries.length > 0) {
    parts.push(`<cross-surface-summaries>\n${summaries.slice(0, 5).join('\n')}\n</cross-surface-summaries>`);
  }

  // Project artifacts
  const artifacts = project.artifacts ?? [];
  if (artifacts.length > 0) {
    const artifactLines = artifacts.map((a: ProjectArtifact) => {
      const surfaceLabel = a.surface.charAt(0).toUpperCase() + a.surface.slice(1);
      return `- ${a.name} (${a.type}, from ${surfaceLabel}): ${a.path}`;
    });
    parts.push(`<project-artifacts>\n${artifactLines.join('\n')}\n</project-artifacts>`);
  }

  if (parts.length === 0) return '';

  return `<project-context>\n${parts.join('\n\n')}\n</project-context>`;
}

/**
 * Generate a summary of the current conversation for handoff to another surface.
 * Returns a brief summary suitable for storing as a project artifact.
 */
export function generateHandoffSummary(
  conversationId: string,
  surface: string,
): string {
  const messages = getMessagesForConversation(conversationId, surface);
  if (messages.length === 0) return 'No conversation content.';

  const userMessages = messages.filter((m) => m.role === 'user' && m.content);
  const assistMessages = messages.filter((m) => m.role === 'assistant' && m.content);

  const parts: string[] = [];
  parts.push(`Surface: ${surface}`);
  parts.push(`Messages: ${messages.length} total (${userMessages.length} user, ${assistMessages.length} assistant)`);

  // Key topics from user messages
  if (userMessages.length > 0) {
    const topics = userMessages.slice(0, 5).map((m) => `  - ${m.content.substring(0, 80)}`);
    parts.push(`Key topics:\n${topics.join('\n')}`);
  }

  // Last assistant response summary
  if (assistMessages.length > 0) {
    const last = assistMessages[assistMessages.length - 1].content;
    parts.push(`Last response: ${last.substring(0, 300)}`);
  }

  return parts.join('\n');
}
