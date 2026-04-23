"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare, Briefcase, Code2, Globe, Bot } from "lucide-react";
import { useAppStore, type Surface } from "@/stores/app-store";
import { useProjectStore } from "@/stores/project-store";
import { useConversationStore } from "@/stores/conversation-store";
import { generateHandoffSummary } from "@/lib/project/context-builder";

const SURFACE_CONFIG: Record<Surface, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  chat: { icon: MessageSquare, label: "Chat" },
  cowork: { icon: Briefcase, label: "Cowork" },
  code: { icon: Code2, label: "Code" },
  browser: { icon: Globe, label: "Browser" },
  assistant: { icon: Bot, label: "Assistant" },
};

interface ContinueInSurfaceProps {
  currentSurface: Surface;
  projectId: string;
  conversationId: string;
}

export function ContinueInSurface({
  currentSurface,
  projectId,
  conversationId,
}: ContinueInSurfaceProps) {
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);
  const addTimelineEntry = useProjectStore((s) => s.addTimelineEntry);
  const addArtifact = useProjectStore((s) => s.addArtifact);
  const addConversationToProject = useProjectStore((s) => s.addConversationToProject);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const addConversation = useConversationStore((s) => s.addConversation);

  const handleContinueIn = useCallback(
    (targetSurface: Surface) => {
      // 1. Generate summary of current conversation
      const summary = generateHandoffSummary(conversationId, currentSurface);

      // 2. Store summary as a project artifact
      const summaryId = crypto.randomUUID();
      addArtifact(projectId, {
        id: summaryId,
        name: `Summary from ${currentSurface}`,
        path: `summary://${currentSurface}/${conversationId}`,
        type: "summary",
        surface: currentSurface,
        conversationId,
        description: summary,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // 3. Add timeline entry
      addTimelineEntry(projectId, {
        id: crypto.randomUUID(),
        surface: currentSurface,
        conversationId,
        action: `Continued from ${currentSurface.charAt(0).toUpperCase() + currentSurface.slice(1)} to ${targetSurface.charAt(0).toUpperCase() + targetSurface.slice(1)}`,
        artifactIds: [summaryId],
        timestamp: Date.now(),
      });

      // 4. Ensure current conversation is registered with the project
      addConversationToProject(projectId, currentSurface, conversationId);

      // 5. Create new conversation in target surface linked to same project
      const newConvId = crypto.randomUUID();
      addConversation({
        id: newConvId,
        title: `Continued from ${currentSurface}`,
        surface: targetSurface,
        lastMessage: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectId,
      });

      // 6. Register the new conversation with the project
      addConversationToProject(projectId, targetSurface, newConvId);

      // 7. Switch surface and activate new conversation
      setActiveConversation(newConvId);
      setActiveSurface(targetSurface);
    },
    [
      currentSurface,
      projectId,
      conversationId,
      setActiveSurface,
      addTimelineEntry,
      addArtifact,
      addConversationToProject,
      setActiveConversation,
      addConversation,
    ]
  );

  const otherSurfaces = (["chat", "cowork", "code", "browser"] as Surface[]).filter(
    (s) => s !== currentSurface
  );

  return (
    <div className="flex items-center gap-1">
      {otherSurfaces.map((surface) => {
        const config = SURFACE_CONFIG[surface];
        const Icon = config.icon;
        return (
          <Button
            key={surface}
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => handleContinueIn(surface)}
          >
            <Icon className="h-3.5 w-3.5" />
            {config.label}
          </Button>
        );
      })}
    </div>
  );
}
