import { type Project, type ProjectArtifact } from '@/stores/project-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useCodeStore } from '@/stores/code-store';
import { useBrowserStore } from '@/stores/browser-store';

/**
 * Get a surface-specific store for reading messages.
 */
function getMessagesForConversation(conversationId: string, surface: string): Array<{ role: string; content: string }> {
  switch (surface) {
    case 'chat':
      return useChatStore.getState().messages[conversationId] ?? [];
    case 'cowork':
      return useCoworkStore.getState().messages[conversationId] ?? [];
    case 'code':
      return useCodeStore.getState().messages[conversationId] ?? [];
    case 'browser':
      return useBrowserStore.getState().messages[conversationId] ?? [];
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
 * Gathers project metadata, summaries from conversations on OTHER surfaces
 * (up to 5 most recent), lists all artifacts, and returns formatted XML string.
 *
 * Uses conversation.projectId as primary lookup (reliable source of truth),
 * falls back to project.conversationIds for any not found that way.
 */
export function buildProjectContext(
  project: Project,
  currentSurface: string,
  currentConversationId: string,
): string {
  const parts: string[] = [];

  // Project identity — always include so the AI knows what project this is
  const metaParts: string[] = [];
  metaParts.push(`Name: ${project.name}`);
  if (project.description) {
    metaParts.push(`Description: ${project.description}`);
  }
  if (project.customInstructions) {
    metaParts.push(`Instructions: ${project.customInstructions}`);
  }
  if (project.folder) {
    metaParts.push(`Working folder: ${project.folder}`);
  }
  if (project.urls && project.urls.length > 0) {
    metaParts.push(`URLs: ${project.urls.join(', ')}`);
  }
  parts.push(`<project-info>\n${metaParts.join('\n')}\n</project-info>`);

  // Knowledge files summary
  if (project.knowledgeFiles.length > 0) {
    const fileLines = project.knowledgeFiles.map((f) => `- ${f.name} (${f.type}, ${(f.size / 1024).toFixed(1)}KB)`);
    parts.push(`<project-files>\n${fileLines.join('\n')}\n</project-files>`);
  }

  // Cross-surface conversation summaries
  // Primary: find conversations linked via conversation.projectId
  const allConversations = useConversationStore.getState().conversations;
  const projectConversations = allConversations.filter(
    (c) => c.projectId === project.id && c.id !== currentConversationId
  );

  // Also check project.conversationIds for any not found via projectId
  const foundIds = new Set(projectConversations.map((c) => c.id));
  for (const convIds of Object.values(project.conversationIds ?? {})) {
    for (const convId of convIds) {
      if (convId === currentConversationId || foundIds.has(convId)) continue;
      const conv = allConversations.find((c) => c.id === convId);
      if (conv) {
        projectConversations.push(conv);
        foundIds.add(convId);
      }
    }
  }

  const summaries: string[] = [];
  // Sort by most recent first, take up to 8
  const sorted = projectConversations
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  for (const conv of sorted) {
    const messages = getMessagesForConversation(conv.id, conv.surface);
    if (messages.length === 0) continue;
    const summary = summarizeConversation(messages);
    if (summary) {
      const surfaceLabel = conv.surface.charAt(0).toUpperCase() + conv.surface.slice(1);
      const titlePart = conv.title ? ` "${conv.title}"` : '';
      summaries.push(`[${surfaceLabel}${titlePart}]: ${summary}`);
    }
  }

  if (summaries.length > 0) {
    parts.push(`<cross-surface-summaries>\n${summaries.join('\n')}\n</cross-surface-summaries>`);
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
