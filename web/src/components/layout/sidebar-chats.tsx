"use client";

import { useEffect, useRef, useState } from "react";
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useAppStore } from "@/stores/app-store";
import {
  conversationMatches,
  deleteConversation,
  restoreConversation,
  type DeletedConversation,
} from "./sidebar-chats-actions";
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

/** How long a deleted conversation can be brought back. */
const UNDO_MS = 8000;

/**
 * One conversation in the list. The delete control is a real button beside
 * the row, not a span inside it — a button nested in a button is invalid, and
 * `hidden group-hover:block` made it unreachable by keyboard.
 */
function ConversationRow({
  conv,
  active,
  icon: Icon,
  onOpen,
  onDelete,
  children,
}: {
  conv: Conversation;
  active: boolean;
  icon: typeof MessageCircle;
  onOpen: () => void;
  onDelete: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`group flex w-full items-center rounded-md text-xs transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate flex-1">{conv.title}</span>
        {children}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${conv.title}`}
        title="Delete"
        className="mr-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SidebarChats({ projectId }: SidebarChatsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [bgExpanded, setBgExpanded] = useState(false);
  const activeSurface = useAppStore((s) => s.activeSurface);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const navigateTo = useConversationStore((s) => s.navigateTo);
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

  /*
   * Delete at once, offer Undo for a few seconds. A confirm dialog on every
   * delete is friction for the common case; no way back is worse for the rare
   * mistake.
   */
  const [deleted, setDeleted] = useState<DeletedConversation | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  function handleDelete(id: string) {
    const snapshot = deleteConversation(id);
    if (!snapshot) return;
    setDeleted(snapshot);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeleted(null), UNDO_MS);
  }

  function handleUndo() {
    if (!deleted) return;
    restoreConversation(deleted);
    setDeleted(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  const filteredGroups = groups
    .map((group) => ({
      ...group,
      conversations: group.conversations.filter((c) => conversationMatches(c, searchQuery)),
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
          aria-label="New chat"
          title="New chat"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter chats…"
            aria-label="Search conversations"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-sidebar-accent/50 border-sidebar-border"
          />
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Conversation list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {filteredGroups.length === 0 && backgroundConversations.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          )}

          {filteredGroups.map((group, i) => (
            <div key={group.label}>
              <div className={`px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/50 ${i > 0 ? "mt-2" : ""}`}>
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.conversations.map((conv) => (
                  <ConversationRow
                    key={conv.id}
                    conv={conv}
                    active={activeId === conv.id}
                    icon={MessageCircle}
                    onOpen={() => navigateTo(conv.id)}
                    onDelete={() => handleDelete(conv.id)}
                  >
                    {conv.roi && (
                      <RoiBadge
                        roi={conv.roi}
                        tokenUsage={conv.tokenUsage}
                        effortEstimate={conv.effortEstimate}
                        size="xs"
                      />
                    )}
                  </ConversationRow>
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
                    <ConversationRow
                      key={conv.id}
                      conv={conv}
                      active={activeId === conv.id}
                      icon={Bot}
                      onOpen={() => navigateTo(conv.id)}
                      onDelete={() => handleDelete(conv.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {deleted && (
        <div
          role="status"
          className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/60 px-2.5 py-1.5 text-xs"
        >
          <span className="min-w-0 flex-1 truncate">Deleted “{deleted.conversation.title}”</span>
          <button type="button" onClick={handleUndo} className="shrink-0 font-medium text-primary hover:underline">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
