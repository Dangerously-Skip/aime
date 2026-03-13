"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Wrench, ChevronDown, Loader2, Check, X } from "lucide-react";

interface ToolCallCardProps {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "complete" | "error";
  startTime?: number;
  endTime?: number;
}

function formatToolPreview(input: Record<string, unknown>): string {
  const previewKeys = [
    "pattern",
    "command",
    "file_path",
    "path",
    "query",
    "content",
    "description",
  ];
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  const key = previewKeys.find((k) => input[k]) || keys[0];
  const value = input[key];

  if (typeof value === "string") {
    return `${key}: ${value.substring(0, 60)}${value.length > 60 ? "..." : ""}`;
  }
  if (Array.isArray(value)) return `${key}: [${value.length} items]`;
  if (typeof value === "object") return `${key}: {...}`;
  return `${key}: ${String(value).substring(0, 40)}`;
}

function formatDuration(startTime: number, endTime?: number): string {
  const end = endTime || Date.now();
  const ms = end - startTime;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_ICONS = {
  running: <Loader2 className="h-3 w-3 animate-spin text-primary" />,
  complete: <Check className="h-3 w-3 text-success" />,
  error: <X className="h-3 w-3 text-destructive" />,
};

export function ToolCallCard({
  name,
  input,
  output,
  status,
  startTime,
  endTime,
}: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(status === "running");
  const preview = formatToolPreview(input);
  const inputStr = JSON.stringify(input, null, 2);
  const maxOutputLen = 2000;
  const truncatedOutput =
    output && output.length > maxOutputLen
      ? output.substring(0, maxOutputLen) + "..."
      : output;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="my-1.5">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs transition-colors hover:bg-accent group">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{name}</span>
        <span className="truncate text-muted-foreground flex-1 text-left">
          {preview}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {startTime && (
            <span className="text-muted-foreground text-[10px]">
              {formatDuration(startTime, endTime)}
            </span>
          )}
          {STATUS_ICONS[status]}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-[22px] mt-1 space-y-2 border-l-2 border-border pl-3">
          {/* Input */}
          <div>
            <Badge variant="outline" className="mb-1 text-[10px]">
              Input
            </Badge>
            <pre className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground overflow-x-auto max-h-40 overflow-y-auto">
              {inputStr}
            </pre>
          </div>

          {/* Output */}
          {output !== undefined && (
            <div>
              <Badge
                variant="outline"
                className={`mb-1 text-[10px] ${
                  status === "error"
                    ? "border-destructive text-destructive"
                    : ""
                }`}
              >
                Output
              </Badge>
              <pre
                className={`rounded p-2 text-[11px] overflow-x-auto max-h-40 overflow-y-auto ${
                  status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted/50 text-muted-foreground"
                }`}
              >
                {truncatedOutput}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
