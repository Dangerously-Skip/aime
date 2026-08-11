"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Wrench, ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { describeToolProgress } from "@/lib/tool-activity";
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
  const { running, label, icon, runningStartTime } = useMemo(() => {
    const running = toolCalls.filter((t) => t.status === "running");
    const errored = toolCalls.filter((t) => t.status === "error");

    /*
     * Say what it is DOING, not how many things have happened.
     *
     * This used to read `Running mcp__aime__SearchWeb...`, and then — for the
     * minutes a research turn spends in tools — a collapsed "7 actions
     * completed". Neither tells the user whether it is working or wedged, and
     * both leak an internal tool id they never chose. See lib/tool-activity.
     */
    const label = describeToolProgress(toolCalls);
    const icon: "spinner" | "wrench" | "warning" =
      running.length > 0 ? "spinner" : errored.length > 0 ? "warning" : "wrench";
    const runningStartTime = running.length > 0 ? running[running.length - 1].startTime : null;

    return { running, label, icon, runningStartTime };
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
