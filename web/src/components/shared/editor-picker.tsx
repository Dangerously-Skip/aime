"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, ChevronDown } from "lucide-react";

interface DetectedEditor {
  id: string;
  name: string;
  command: string;
}

interface EditorPickerProps {
  folder: string | null;
}

export function EditorPicker({ folder }: EditorPickerProps) {
  const [editors, setEditors] = useState<DetectedEditor[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.detectEditors) return;
    window.electronAPI.detectEditors().then(setEditors).catch(() => {});
  }, []);

  // Don't render until we've detected editors (avoids SSR/hydration issues)
  if (editors.length === 0) return null;

  function handleOpen(editor: DetectedEditor) {
    if (!folder || !window.electronAPI?.openInEditor) return;
    window.electronAPI.openInEditor(editor.id, folder);
  }

  if (editors.length === 1) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        disabled={!folder}
        onClick={() => handleOpen(editors[0])}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open in {editors[0].name}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={!folder}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in...
            <ChevronDown className="h-3 w-3" />
          </Button>
        }
      />
      <DropdownMenuContent side="top" align="start" sideOffset={8}>
        {editors.map((editor) => (
          <DropdownMenuItem
            key={editor.id}
            onClick={() => handleOpen(editor)}
          >
            {editor.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
