"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Check } from "lucide-react";
import { useMemoryStore } from "@/stores/memory-store";
import { useConversationStore } from "@/stores/conversation-store";
import { suggestCategory, MEMORY_CATEGORIES, type MemoryCategory } from "@/lib/memory/types";

interface MemoryButtonProps {
  content: string;
  conversationId?: string;
}

export function MemoryButton({ content, conversationId }: MemoryButtonProps) {
  const [open, setOpen] = useState(false);
  const [memoryText, setMemoryText] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [saved, setSaved] = useState(false);
  const addMemoryWithDedup = useMemoryStore((s) => s.addMemoryWithDedup);

  const handleOpen = useCallback(() => {
    // Pre-fill with a summary of the content (first 200 chars)
    const summary = content.length > 200 ? content.substring(0, 200) + "..." : content;
    setMemoryText(summary);
    setCategory(suggestCategory(content));
    setSaved(false);
  }, [content]);

  const handleSave = useCallback(() => {
    if (!memoryText.trim()) return;

    // Determine scope based on current project
    const conversations = useConversationStore.getState().conversations;
    const conv = conversationId
      ? conversations.find((c) => c.id === conversationId)
      : null;
    const projectId = conv?.projectId || null;
    const scope = projectId ? "project" : "global";

    // Extract tags from content
    const tags = memoryText
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 10);

    addMemoryWithDedup({
      id: crypto.randomUUID(),
      content: memoryText.trim(),
      category,
      scope,
      projectId,
      tags: [...new Set(tags)],
      confidence: 1.0,
      accessCount: 0,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      supersededBy: null,
      source: "explicit",
    });

    setSaved(true);
    setTimeout(() => {
      setOpen(false);
      setSaved(false);
    }, 1000);
  }, [memoryText, category, conversationId, addMemoryWithDedup]);

  if (saved) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-green-500"
        disabled
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        onClick={handleOpen}
        title="Save to memory"
      >
        <Brain className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-80" side="top" align="start">
        <div className="space-y-3">
          <div className="text-sm font-medium">Save to Memory</div>
          <Textarea
            value={memoryText}
            onChange={(e) => setMemoryText(e.target.value)}
            placeholder="What should I remember?"
            rows={3}
            className="text-sm resize-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {MEMORY_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  category === cat.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSave} disabled={!memoryText.trim()}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
