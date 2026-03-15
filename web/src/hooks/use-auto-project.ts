'use client';

import { useCallback } from 'react';
import { useProjectStore, getRandomIcon } from '@/stores/project-store';
import { useConversationStore } from '@/stores/conversation-store';

/**
 * Shared hook for auto-associating a folder with a project.
 * Used by both Code and Cowork surfaces.
 */
export function useAutoProject(surface: 'code' | 'cowork') {
  const handleFolderSelected = useCallback(
    (folder: string, conversationId: string) => {
      const { projects, addProject, addConversationToProject } =
        useProjectStore.getState();
      const { assignToProject } = useConversationStore.getState();

      // Check if a project already exists for this folder
      const existing = projects.find((p) => p.folder === folder);

      if (existing) {
        assignToProject(conversationId, existing.id);
        addConversationToProject(existing.id, surface, conversationId);
      } else {
        // Create new project named after the folder
        const folderName = folder.split('/').pop() || folder;
        const newId = crypto.randomUUID();
        addProject({
          id: newId,
          name: folderName,
          description: '',
          customInstructions: '',
          knowledgeFiles: [],
          surfaces: [surface],
          color: '',
          icon: getRandomIcon(),
          starred: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          artifacts: [],
          timeline: [],
          conversationIds: {},
          folder,
        });
        assignToProject(conversationId, newId);
        addConversationToProject(newId, surface, conversationId);
      }
    },
    [surface]
  );

  return { handleFolderSelected };
}
