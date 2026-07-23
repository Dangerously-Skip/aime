"use client";

import { useState, useEffect } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Wrench, ChevronDown, Loader2, Check, X, FileText, Globe, AlertTriangle, Square } from "lucide-react";
import { detectServerUrl } from "@/lib/artifacts/server-detector";
import { BASH_ARTIFACT_EXT } from "@/lib/artifact-tracker";

const ARTIFACT_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

// Elapsed-time thresholds for the running-tool badge.
// At AMBER the badge changes colour to flag a slow tool; at TIMEOUT we
// surface a Cancel button so the user can abort instead of waiting on a
// hung tool. Values picked to feel snappy without nagging on routine
// 30-60s WebFetches.
const ELAPSED_AMBER_S = 30;
const ELAPSED_TIMEOUT_S = 90;

/**
 * For a Bash command like `bash generate_presentation.sh in.md out.pptx`,
 * pick the rightmost token matching a binary/document extension and treat
 * it as the artifact the command produced. Returns null if no match.
 */
function detectBashArtifactPath(input: Record<string, unknown>): string | null {
  const cmd = typeof input.command === "string" ? input.command : "";
  if (!cmd) return null;
  BASH_ARTIFACT_EXT.lastIndex = 0;
  const matches = [...cmd.matchAll(BASH_ARTIFACT_EXT)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].replace(/['"]/g, "");
}

interface ToolCallCardProps {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "complete" | "error";
  startTime?: number;
  endTime?: number;
  onArtifactClick?: (path: string) => void;
  onPreviewUrl?: (url: string) => void;
  /** Abort the parent SSE stream. When provided, a Cancel button appears
      once a running tool has been pending past ELAPSED_TIMEOUT_S. */
  onCancel?: () => void;
}

/** Live-ticking elapsed badge for running tools. Idle (complete/error)
 *  tools render a static duration via formatDuration on the parent. */
function RunningElapsedBadge({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startTime) / 1000));
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const tone =
    elapsed >= ELAPSED_TIMEOUT_S
      ? "text-destructive"
      : elapsed >= ELAPSED_AMBER_S
      ? "text-orange-500"
      : "text-muted-foreground";
  return <span className={`tabular-nums text-[10px] ${tone}`}>{elapsed}s</span>;
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
  onArtifactClick,
  onPreviewUrl,
  onCancel,
}: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(status === "running");
  // Re-render every second while running so the inline cancel button can
  // appear once the tool is past ELAPSED_TIMEOUT_S — the elapsed badge
  // already ticks via its own state, but the trigger row needs to know
  // when to show the button.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "running" || !startTime) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, startTime]);
  const elapsedS = startTime && status === "running" ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const showCancel = status === "running" && !!onCancel && elapsedS >= ELAPSED_TIMEOUT_S;
  const [showFullOutput, setShowFullOutput] = useState(false);
  const preview = formatToolPreview(input);
  const inputStr = JSON.stringify(input, null, 2);
  const hasSecurityWarning = !!input.__securityWarning;
  const filePath = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;
  const maxOutputLen = 2000;
  const isOutputTruncated = output ? output.length > maxOutputLen : false;
  const displayOutput = showFullOutput
    ? output
    : output && isOutputTruncated
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
          {hasSecurityWarning && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-500 font-medium">
              <AlertTriangle className="h-3 w-3" />
              Risky
            </span>
          )}
          {startTime && status === "running" ? (
            <RunningElapsedBadge startTime={startTime} />
          ) : startTime ? (
            <span className="text-muted-foreground text-[10px]">
              {formatDuration(startTime, endTime)}
            </span>
          ) : null}
          {showCancel && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCancel?.(); }}
              className="inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 transition-colors"
              title={`Tool has been running for ${elapsedS}s — click to cancel`}
            >
              <Square className="h-2.5 w-2.5 fill-current" />
              Cancel
            </button>
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
                className={`rounded p-2 text-[11px] overflow-x-auto ${showFullOutput ? "max-h-[80vh]" : "max-h-40"} overflow-y-auto ${
                  status === "error"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted/50 text-muted-foreground"
                }`}
              >
                {displayOutput}
              </pre>
              {isOutputTruncated && (
                <button
                  type="button"
                  onClick={() => setShowFullOutput((prev) => !prev)}
                  className="mt-1 text-[10px] text-primary hover:underline"
                >
                  {showFullOutput ? "Show less" : `Show full output (${output!.length.toLocaleString()} chars)`}
                </button>
              )}
            </div>
          )}

          {/* Artifact preview chip for Write/Edit tools */}
          {ARTIFACT_TOOLS.has(name) && status === "complete" && filePath && (() => {
            const isHtml = /\.html?$/i.test(filePath);
            if (isHtml && onPreviewUrl) {
              return (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPreviewUrl(`file://${filePath}`); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
                >
                  <Globe className="h-3 w-3" />
                  Preview {filePath.split("/").pop()}
                </button>
              );
            }
            if (onArtifactClick) {
              return (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onArtifactClick(filePath); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
                >
                  <FileText className="h-3 w-3" />
                  Preview {filePath.split("/").pop()}
                </button>
              );
            }
            return null;
          })()}

          {/* Dev server preview chip for Bash tools */}
          {name === "Bash" && status === "complete" && output && onPreviewUrl && (() => {
            const detected = detectServerUrl(output);
            if (!detected) return null;
            return (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onPreviewUrl(detected.url); }}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
              >
                <Globe className="h-3 w-3" />
                Open Preview
              </button>
            );
          })()}

          {/* Artifact preview chip for Bash tools that produced a file
              (e.g. the ppt plugin's generate_presentation.sh writing a .pptx).
              Falls through to onArtifactClick like Write/Edit do. */}
          {name === "Bash" && status === "complete" && onArtifactClick && (() => {
            const bashPath = detectBashArtifactPath(input);
            if (!bashPath) return null;
            return (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onArtifactClick(bashPath); }}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
              >
                <FileText className="h-3 w-3" />
                Preview {bashPath.split("/").pop()}
              </button>
            );
          })()}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
