"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PROJECT_ICONS, getRandomIcon } from "@/stores/project-store";
import { ProjectIcon } from "@/components/shared/project-icon";

interface ProjectCreateProps {
  onCancel: () => void;
  onCreate: (name: string, description: string, icon: string) => void;
}

export function ProjectCreate({ onCancel, onCreate }: ProjectCreateProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(() => getRandomIcon());

  function handleCreate() {
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim(), icon);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleCreate();
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="w-full max-w-xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-light text-foreground tracking-tight mb-8">
          Create a personal project
        </h1>

        <div className="space-y-5" onKeyDown={handleKeyDown}>
          {/* Icon picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Choose an icon
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_ICONS.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setIcon(iconName)}
                  className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all ${
                    icon === iconName
                      ? "bg-primary/10 ring-2 ring-primary ring-offset-1 ring-offset-background text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <ProjectIcon icon={iconName} className="h-4.5 w-4.5" />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              What are you working on?
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your project"
              className="h-11"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              What are you trying to achieve?
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your project, goals, subject, etc..."
              rows={4}
              className="resize-none text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim()}>
              Create project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
