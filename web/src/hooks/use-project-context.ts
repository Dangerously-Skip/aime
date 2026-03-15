'use client';

import { useMemo } from 'react';
import { useConversationStore } from '@/stores/conversation-store';
import { useProjectStore, type ProjectArtifact } from '@/stores/project-store';
import { buildProjectContext } from '@/lib/project/context-builder';

interface ProjectContext {
  projectInstructions: string | null;
  projectKnowledge: string | null;
  projectId: string | null;
  projectName: string | null;
  projectIcon: string | null;
  crossSurfaceContext: string | null;
  projectFolder: string | null;
  projectArtifacts: ProjectArtifact[];
}

export function useProjectContext(conversationId: string, currentSurface?: string): ProjectContext {
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
        crossSurfaceContext: null,
        projectFolder: null,
        projectArtifacts: [],
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
        crossSurfaceContext: null,
        projectFolder: null,
        projectArtifacts: [],
      };
    }

    const instructions = project.customInstructions || null;

    let knowledge: string | null = null;
    if (project.knowledgeFiles.length > 0) {
      knowledge = project.knowledgeFiles
        .map((f) => `[File: ${f.name}]\n${f.content}`)
        .join('\n\n---\n\n');
    }

    // Build cross-surface context
    const surface = currentSurface || conversation.surface || '';
    let crossSurfaceContext: string | null = null;
    try {
      const ctx = buildProjectContext(project, surface, conversationId);
      crossSurfaceContext = ctx || null;
    } catch {
      // Context building failed, non-fatal
    }

    return {
      projectInstructions: instructions,
      projectKnowledge: knowledge,
      projectId: project.id,
      projectName: project.name,
      projectIcon: project.icon || null,
      crossSurfaceContext,
      projectFolder: project.folder || null,
      projectArtifacts: project.artifacts ?? [],
    };
  }, [conversations, projects, conversationId, currentSurface]);
}
