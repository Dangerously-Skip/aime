"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Brain, ChevronDown } from "lucide-react";

interface ThinkingSectionProps {
  content: string;
  isComplete?: boolean;
  defaultOpen?: boolean;
}

export function ThinkingSection({
  content,
  isComplete = false,
  defaultOpen = false,
}: ThinkingSectionProps) {
  const charCount = content.length;
  const label = isComplete
    ? `Thought (${charCount.toLocaleString()} chars)`
    : `Thinking (${charCount.toLocaleString()} chars)`;

  return (
    <Collapsible defaultOpen={defaultOpen} className="mb-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors group">
        <Brain className="h-3.5 w-3.5" />
        <span>{label}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
