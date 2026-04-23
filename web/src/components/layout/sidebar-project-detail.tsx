"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useAppStore, type Surface } from "@/stores/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Plus,
  Search,
  Trash2,
  MessageCircle,
  Briefcase,
  Terminal,
  Globe,
  Bot,
} from "lucide-react";
import { ProjectIcon } from "@/components/shared/project-icon";

const SURFACE_CONFIG: Record<
  Surface,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  chat: { icon: MessageCircle, label: "Chat" },
  cowork: { icon: Briefcase, label: "Cowork" },
  code: { icon: Terminal, label: "Code" },
  browser: { icon: Globe, label: "Browser" },
  assistant: { icon: Bot, label: "Assistant" },
};

const SURFACE_ORDER: Surface[] = ["chat", "cowork", "code", "browser"];

interface SidebarProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

export function SidebarProjectDetail({
  projectId,
  onBack,
}: SidebarProjectDetailProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const conversations = useConversationStore((s) => s.conversations);
  const removeConversation = useConversationStore((s) => s.removeConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const activeId = useConversationStore((s) => s.activeId);
  const activeSurface = useAppStore((s) => s.activeSurface);
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const setViewingProjectId = useAppStore((s) => s.setViewingProjectId);

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-xs text-muted-foreground">
        Project not found
        <Button variant="ghost" size="sm" onClick={onBack} className="mt-2">
          Go back
        </Button>
      </div>
    );
  }

  // Get all project conversations, filtered by search
  const projectConversations = conversations
    .filter((c) => c.projectId === projectId)
    .filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Group by surface
  const surfaceGroups = SURFACE_ORDER
    .map((surface) => ({
      surface,
      config: SURFACE_CONFIG[surface],
      conversations: projectConversations.filter((c) => c.surface === surface),
    }))
    .filter((g) => g.conversations.length > 0);

  function handleOpenConversation(conv: Conversation) {
    setActiveSurface(conv.surface as Surface);
    setActiveConversation(conv.id);
    setSidebarMode("history");
    setViewingProjectId(null);
  }

  function handleNewChat() {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      surface: activeSurface,
      lastMessage: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId,
    };
    addConversation(conv);
    setActiveConversation(conv.id);
  }

  return (
    <>
      {/* Project header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <ProjectIcon icon={project.icon} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold truncate flex-1">
          {project.name}
        </span>
      </div>

      {/* Description */}
      {project.description && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-sidebar-border">
          {project.description}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-medium text-muted-foreground">
          All Conversations
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-sidebar-foreground hover:text-foreground"
          onClick={handleNewChat}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-sidebar-accent/50 border-sidebar-border"
          />
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Conversation list grouped by surface */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {surfaceGroups.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          )}

          {surfaceGroups.map(({ surface, config, conversations: convs }) => {
            const Icon = config.icon;
            return (
              <div key={surface}>
                <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  {config.label} ({convs.length})
                </div>
                <div className="space-y-0.5">
                  {convs.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => handleOpenConversation(conv)}
                      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        activeId === conv.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{conv.title}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeConversation(conv.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            removeConversation(conv.id);
                          }
                        }}
                        className="hidden group-hover:block shrink-0"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}
