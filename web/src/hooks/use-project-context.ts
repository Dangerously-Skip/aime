'use client';

import { useMemo } from 'react';
import { useConversationStore } from '@/stores/conversation-store';
import { useProjectStore } from '@/stores/project-store';

interface ProjectContext {
  projectInstructions: string | null;
  projectKnowledge: string | null;
  projectId: string | null;
  projectName: string | null;
  projectIcon: string | null;
}

export function useProjectContext(conversationId: string): ProjectContext {
  const conversations = useConversationStore((s) => s.conversations);
  const projects = useProjectStore((s) => s.projects);

  return useMemo(() => {
    const conversation = conversations.find((c) => c.id === conversationId);
    if (!conversation?.projectId) {
      return {
        projectInstructions: null,
        projectKnowledge: null,
        projectId: null,
        projectName: null,
        projectIcon: null,
      };
    }

    const project = projects.find((p) => p.id === conversation.projectId);
    if (!project) {
      return {
        projectInstructions: null,
        projectKnowledge: null,
        projectId: conversation.projectId,
        projectName: null,
        projectIcon: null,
      };
    }

    const instructions = project.customInstructions || null;

    let knowledge: string | null = null;
    if (project.knowledgeFiles.length > 0) {
      knowledge = project.knowledgeFiles
        .map((f) => `[File: ${f.name}]\n${f.content}`)
        .join('\n\n---\n\n');
    }

    return {
      projectInstructions: instructions,
      projectKnowledge: knowledge,
      projectId: project.id,
      projectName: project.name,
      projectIcon: project.icon || null,
    };
  }, [conversations, projects, conversationId]);
}
