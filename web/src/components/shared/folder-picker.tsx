"use client";

import { useState } from "react";
import { useElectron } from "@/hooks/use-electron";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { TrustWorkspaceDialog } from "@/components/shared/trust-workspace-dialog";
import { Folder, FolderOpen, Check, FolderPlus } from "lucide-react";

interface FolderPickerProps {
  folder: string | null;
  onFolderChange: (folder: string | null) => void;
  className?: string;
}

export function FolderPicker({
  folder,
  onFolderChange,
  className,
}: FolderPickerProps) {
  const { isElectron, selectFolder } = useElectron();
  const recentFolders = useSettingsStore((s) => s.recentFolders);
  const addRecentFolder = useSettingsStore((s) => s.addRecentFolder);
  const trustedFolders = useSettingsStore((s) => s.trustedFolders);
  const addTrustedFolder = useSettingsStore((s) => s.addTrustedFolder);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);

  function selectFolderWithTrust(path: string) {
    if (trustedFolders.includes(path)) {
      onFolderChange(path);
      addRecentFolder(path);
      setPopoverOpen(false);
    } else {
      setPendingFolder(path);
      setTrustDialogOpen(true);
    }
  }

  function handleTrust() {
    if (pendingFolder) {
      addTrustedFolder(pendingFolder);
      onFolderChange(pendingFolder);
      addRecentFolder(pendingFolder);
    }
    setTrustDialogOpen(false);
    setPendingFolder(null);
    setPopoverOpen(false);
  }

  function handleTrustCancel() {
    setTrustDialogOpen(false);
    setPendingFolder(null);
  }

  async function handleChooseFolder() {
    if (!isElectron) return;
    const selected = await selectFolder();
    if (selected) {
      selectFolderWithTrust(selected);
    }
  }

  const displayPath = folder
    ? folder.split("/").slice(-2).join("/")
    : "No folder selected";

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={`h-7 gap-1.5 text-xs ${className}`}
              disabled={!isElectron}
            />
          }
        >
          {folder ? (
            <FolderOpen className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Folder className="h-3.5 w-3.5" />
          )}
          <span className="max-w-[120px] truncate">{displayPath}</span>
        </PopoverTrigger>

        <PopoverContent side="top" sideOffset={8} className="w-72 p-1">
          {recentFolders.length > 0 && (
            <>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Recent
              </div>
              {recentFolders.map((path) => {
                const name = path.split("/").pop() || path;
                const isActive = path === folder;
                return (
                  <button
                    key={path}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left"
                    onClick={() => selectFolderWithTrust(path)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {path}
                      </div>
                    </div>
                    {isActive && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}
              <div className="-mx-1 my-1 h-px bg-border" />
            </>
          )}

          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
            onClick={handleChooseFolder}
          >
            <FolderPlus className="h-4 w-4 text-muted-foreground" />
            Choose a different folder
          </button>
        </PopoverContent>
      </Popover>

      <TrustWorkspaceDialog
        open={trustDialogOpen}
        folderPath={pendingFolder || ""}
        onTrust={handleTrust}
        onCancel={handleTrustCancel}
      />
    </>
  );
}
