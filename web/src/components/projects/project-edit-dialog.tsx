"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PROJECT_ICONS } from "@/stores/project-store";
import { ProjectIcon } from "@/components/shared/project-icon";

interface ProjectEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description: string;
  icon: string;
  onSave: (name: string, description: string, icon: string) => void;
}

export function ProjectEditDialog({
  open,
  onOpenChange,
  name,
  description,
  icon,
  onSave,
}: ProjectEditDialogProps) {
  const [nameValue, setNameValue] = useState(name);
  const [descValue, setDescValue] = useState(description);
  const [iconValue, setIconValue] = useState(icon);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the editable form from props each time the dialog opens; callers don't remount it with a key
      setNameValue(name);
      setDescValue(description);
      setIconValue(icon);
      setIconPickerOpen(false);
    }
  }, [open, name, description, icon]);

  function handleSave() {
    if (!nameValue.trim()) return;
    onSave(nameValue.trim(), descValue.trim(), iconValue);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Icon — clickable to expand picker */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Icon</label>
            {iconPickerOpen ? (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-border bg-muted/30">
                {PROJECT_ICONS.map((iconName) => (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => {
                      setIconValue(iconName);
                      setIconPickerOpen(false);
                    }}
                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                      iconValue === iconName
                        ? "bg-primary/10 ring-2 ring-primary text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <ProjectIcon icon={iconName} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIconPickerOpen(true)}
                className="h-10 w-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ProjectIcon icon={iconValue} className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Name</label>
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder="Project name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Description</label>
            <Textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              placeholder="Describe your project, goals, subject, etc..."
              rows={5}
              className="resize-none text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!nameValue.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
