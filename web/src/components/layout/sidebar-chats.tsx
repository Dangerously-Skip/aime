"use client";

import { useState } from "react";
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useChatStore } from "@/stores/chat-store";
import { useCoworkStore } from "@/stores/cowork-store";
import { useCodeStore } from "@/stores/code-store";
import { useAppStore } from "@/stores/app-store";
import { useConversations } from "@/hooks/use-conversations";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Search,
  Trash2,
  MessageCircle,
  Bot,
  ChevronRight,
} from "lucide-react";
import { RoiBadge } from "@/components/shared/roi-badge";

interface SidebarChatsProps {
  projectId?: string | null;
}

/** Clear the current chat ID from the surface-specific store when deleting an active conversation */
function clearSurfaceChat(convId: string) {
  const conv = useConversationStore.getState().conversations.find(c => c.id === convId);
  const surface = conv?.surface;
  if (surface === 'chat') useChatStore.getState().setCurrentChat('');
  else if (surface === 'cowork') useCoworkStore.getState().setCurrentChat('');
  else if (surface === 'code') useCodeStore.getState().setCurrentChat('');
}

export function SidebarChats({ projectId }: SidebarChatsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [bgExpanded, setBgExpanded] = useState(false);
  const activeSurface = useAppStore((s) => s.activeSurface);
  const addConversation = useConversationStore((s) => s.addConversation);
  const removeConversation = useConversationStore((s) => s.removeConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const activeId = useConversationStore((s) => s.activeId);
  const { groups, backgroundConversations } = useConversations(activeSurface, projectId);

  function handleNewChat() {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      surface: activeSurface,
      lastMessage: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: projectId || undefined,
    };
    addConversation(conv);
    setActiveConversation(conv.id);
  }

  const filteredGroups = groups
    .map((group) => ({
      ...group,
      conversations: group.conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((group) => group.conversations.length > 0);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-medium text-muted-foreground">
          {projectId ? "Project Chats" : "All Chats"}
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

      {/* Conversation list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-3">
          {filteredGroups.length === 0 && backgroundConversations.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          )}

          {filteredGroups.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConversation(conv.id)}
                    className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      activeId === conv.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`}
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{conv.title}</span>
                    {conv.roi && (
                      <RoiBadge
                        roi={conv.roi}
                        tokenUsage={conv.tokenUsage}
                        effortEstimate={conv.effortEstimate}
                        size="xs"
                      />
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (useConversationStore.getState().activeId === conv.id) {
                          clearSurfaceChat(conv.id);
                        }
                        removeConversation(conv.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          const wasActive = useConversationStore.getState().activeId === conv.id;
                          removeConversation(conv.id);
                          if (wasActive) {
                            useChatStore.getState().setCurrentChat('');
                          }
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
          ))}

          {backgroundConversations.length > 0 && (
            <div>
              <button
                onClick={() => setBgExpanded((v) => !v)}
                className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${bgExpanded ? "rotate-90" : ""}`}
                />
                <Bot className="h-3 w-3" />
                <span>Background runs</span>
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] leading-none">
                  {backgroundConversations.length}
                </span>
              </button>
              {bgExpanded && (
                <div className="space-y-0.5 mt-0.5">
                  {backgroundConversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => setActiveConversation(conv.id)}
                      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        activeId === conv.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                      }`}
                    >
                      <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{conv.title}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          const wasActive = useConversationStore.getState().activeId === conv.id;
                          removeConversation(conv.id);
                          if (wasActive) {
                            useChatStore.getState().setCurrentChat('');
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            const wasActive = useConversationStore.getState().activeId === conv.id;
                            removeConversation(conv.id);
                            if (wasActive) {
                              useChatStore.getState().setCurrentChat('');
                            }
                          }
                        }}
                        className="hidden group-hover:block shrink-0"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
