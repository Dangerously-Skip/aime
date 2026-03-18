"use client";

import { useMemo } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Wrench, ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { ToolCallCard } from "./tool-call-card";
import type { ParsedArtifact } from "@/lib/artifacts/parser";

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "complete" | "error";
  startTime: number;
  endTime?: number;
}

interface ToolCallsSummaryBarProps {
  toolCalls: ToolCall[];
  onArtifactClick?: (path: string | ParsedArtifact) => void;
  onPreviewUrl?: (url: string) => void;
}

export function ToolCallsSummaryBar({
  toolCalls,
  onArtifactClick,
  onPreviewUrl,
}: ToolCallsSummaryBarProps) {
  const { running, completed, errored, label, icon } = useMemo(() => {
    const running = toolCalls.filter((t) => t.status === "running");
    const completed = toolCalls.filter((t) => t.status === "complete");
    const errored = toolCalls.filter((t) => t.status === "error");
    const total = toolCalls.length;

    let label: string;
    let icon: "spinner" | "wrench" | "warning";

    if (running.length > 0) {
      const currentName = running[running.length - 1].name;
      if (completed.length + errored.length === 0) {
        label = `Running ${currentName}...`;
      } else {
        label = `${completed.length + errored.length} completed, ${running.length} running (${currentName})`;
      }
      icon = "spinner";
    } else if (errored.length > 0) {
      label = `${total} action${total !== 1 ? "s" : ""} (${errored.length} failed)`;
      icon = "warning";
    } else {
      label = `${total} action${total !== 1 ? "s" : ""} completed`;
      icon = "wrench";
    }

    return { running, completed, errored, label, icon };
  }, [toolCalls]);

  const StatusIcon =
    icon === "spinner" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : icon === "warning" ? (
      <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
    ) : (
      <Wrench className="h-3.5 w-3.5" />
    );

  return (
    <Collapsible className="mb-2">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors group">
        {StatusIcon}
        <span>{label}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 space-y-1.5">
          {toolCalls.map((tool) => (
            <ToolCallCard
              key={tool.id}
              name={tool.name}
              input={tool.input}
              output={tool.output}
              status={tool.status}
              startTime={tool.startTime}
              endTime={tool.endTime}
              onArtifactClick={onArtifactClick}
              onPreviewUrl={onPreviewUrl}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
