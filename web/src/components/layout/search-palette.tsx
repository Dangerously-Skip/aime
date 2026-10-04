"use client";

import { useMemo } from "react";
import { APP_NAME } from "@/config/branding";
import { useAppStore, type CustomizeSection, type Surface } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Bot,
  Cable,
  Code2,
  FolderKanban,
  Globe,
  MessageCircle,
  MessagesSquare,
  Palette,
  Plus,
  Puzzle,
  Settings,
  Sparkles,
  Timer,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

const SURFACE_ITEMS: { id: Surface; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "cowork", label: "Cowork", icon: Users },
  { id: "code", label: "Code", icon: Code2 },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "assistant", label: "Assistant", icon: Sparkles },
];

const CUSTOMIZE_ITEMS: { section: CustomizeSection; label: string; icon: LucideIcon }[] = [
  { section: "skills", label: "Skills", icon: Zap },
  { section: "connectors", label: "Connectors", icon: Cable },
  { section: "browse-marketplace", label: "Marketplace", icon: Puzzle },
  { section: "agents", label: "Agents", icon: Bot },
  { section: "design", label: "Design", icon: Palette },
  { section: "automation", label: "Automation", icon: Timer },
];

/** Enough to find anything recent without rendering thousands of rows. */
const MAX_CHATS = 200;

/**
 * ⌘K: one place to search chats and jump anywhere.
 *
 * There were two search affordances — "Search ⌘K" in the sidebar header and
 * the "Search..." field above the chat list — and ⌘K only switched to Chats
 * and focused the field, via a `[placeholder="Search..."]` selector that
 * matched whichever input happened to carry that placeholder. The field
 * filtered only the current surface's list, so a chat from another surface was
 * unfindable from the shortcut that says "search". The palette searches every
 * conversation, plus the places and actions you would otherwise click to.
 */
export function SearchPalette({
  open,
  onOpenChange,
  onNewChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewChat: () => void;
}) {
  const conversations = useConversationStore((s) => s.conversations);

  const recent = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS),
    [conversations],
  );

  /** Run an action and close — every item does both. */
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  const app = () => useAppStore.getState();

  const openConversation = (id: string, surface: string) => {
    app().setActiveSurface(surface as Surface);
    app().setSidebarMode("history");
    app().setViewingProjectId(null);
    useConversationStore.getState().navigateTo(id);
  };

  const openSurface = (surface: Surface) => {
    app().setActiveSurface(surface);
    app().setSidebarMode("history");
  };

  const openCustomize = (section: CustomizeSection) => {
    app().setSidebarMode("customize");
    app().setCustomizeSection(section);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description={`Search your chats and jump anywhere in ${APP_NAME}`}
      className="sm:max-w-lg"
    >
      <Command>
        <CommandInput placeholder="Search chats, surfaces, settings…" aria-label="Search" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

          <CommandGroup heading="Actions">
            <CommandItem value="New chat" onSelect={run(onNewChat)}>
              <Plus />
              New chat
              <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
            <CommandItem value="Settings preferences" onSelect={run(() => app().openSettings())}>
              <Settings />
              Settings
              <CommandShortcut>⌘,</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          {recent.length > 0 && (
            <CommandGroup heading="Chats">
              {recent.map((c) => (
                <CommandItem
                  key={c.id}
                  // Unique per row, and what cmdk matches on: title first, then
                  // the last message and surface so either finds it.
                  value={`${c.title} ${c.lastMessage ?? ""} ${c.surface} ${c.id}`}
                  onSelect={run(() => openConversation(c.id, c.surface))}
                >
                  <MessagesSquare />
                  <span className="truncate">{c.title || "Untitled"}</span>
                  <span className="ml-auto shrink-0 text-xs capitalize text-muted-foreground">{c.surface}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandGroup heading="Go to">
            {SURFACE_ITEMS.map(({ id, label, icon: Icon }) => (
              <CommandItem key={id} value={`Go to ${label}`} onSelect={run(() => openSurface(id))}>
                <Icon />
                {label}
              </CommandItem>
            ))}
            <CommandItem value="Go to Projects" onSelect={run(() => app().setSidebarMode("projects"))}>
              <FolderKanban />
              Projects
            </CommandItem>
            {CUSTOMIZE_ITEMS.map(({ section, label, icon: Icon }) => (
              <CommandItem
                key={section}
                value={`Customize ${label}`}
                onSelect={run(() => openCustomize(section))}
              >
                <Icon />
                Customize › {label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
