"use client";

import { useState, useCallback } from "react";
import { useConnectorStore } from "@/stores/connector-store";
import { useCodeStore } from "@/stores/code-store";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Monitor, Github, ChevronDown } from "lucide-react";
import { CloneFromGitHub } from "./clone-from-github";

export function ConnectionSelector() {
  const currentChatId = useCodeStore((s) => s.currentChatId);
  const folder = useCodeStore((s) =>
    currentChatId ? s.folderByChat[currentChatId] ?? null : null
  );
  const setFolder = useCodeStore((s) => s.setFolder);
  const isGithubConnected = useConnectorStore(
    (s) => !!s.connectorStates['github']?.authenticated && !!s.tokens['github']
  );
  const [cloneOpen, setCloneOpen] = useState(false);

  const handleCloned = useCallback(
    (path: string) => {
      if (currentChatId) setFolder(currentChatId, path);
    },
    [setFolder, currentChatId]
  );

  const label = folder ? folder.split("/").filter(Boolean).pop() || "Local" : "Local";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Monitor className="h-3.5 w-3.5" />
              <span className="max-w-[200px] truncate">{label}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          }
        />

        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Working folder
            </DropdownMenuLabel>
            <DropdownMenuItem disabled className="text-xs opacity-80">
              <Monitor className="h-3.5 w-3.5" />
              <span className="truncate">{folder || "No folder selected"}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
              GitHub
            </DropdownMenuLabel>
            {isGithubConnected ? (
              <DropdownMenuItem onClick={() => setCloneOpen(true)}>
                <Github className="h-4 w-4" />
                Clone a repo...
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled className="text-xs opacity-60">
                <Github className="h-4 w-4" />
                Connect GitHub in Customize
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <CloneFromGitHub
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        onCloned={handleCloned}
      />
    </>
  );
}
