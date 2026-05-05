"use client";

import { useMemo, useState, useEffect } from "react";
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
  /** Forwarded to ToolCallCard so a stuck tool can offer Cancel inline. */
  onCancel?: () => void;
}

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startTime) / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  return <span className="tabular-nums text-muted-foreground/70">({elapsed}s)</span>;
}

export function ToolCallsSummaryBar({
  toolCalls,
  onArtifactClick,
  onPreviewUrl,
  onCancel,
}: ToolCallsSummaryBarProps) {
  const { running, completed, errored, label, icon, runningStartTime } = useMemo(() => {
    const running = toolCalls.filter((t) => t.status === "running");
    const completed = toolCalls.filter((t) => t.status === "complete");
    const errored = toolCalls.filter((t) => t.status === "error");
    const total = toolCalls.length;

    let label: string;
    let icon: "spinner" | "wrench" | "warning";
    let runningStartTime: number | null = null;

    if (running.length > 0) {
      const current = running[running.length - 1];
      const currentName = current.name;
      runningStartTime = current.startTime;
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

    return { running, completed, errored, label, icon, runningStartTime };
  }, [toolCalls]);

  const isRunning = running.length > 0;

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
      <CollapsibleTrigger
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors group ${
          isRunning ? "animate-pulse" : ""
        }`}
      >
        {StatusIcon}
        <span>{label}</span>
        {isRunning && runningStartTime && (
          <ElapsedTimer startTime={runningStartTime} />
        )}
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
              onCancel={onCancel}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
