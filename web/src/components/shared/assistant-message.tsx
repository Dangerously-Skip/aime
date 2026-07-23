"use client";

import { useState, useMemo, useEffect } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThinkingSection } from "./thinking-section";
import { ToolCallsSummaryBar } from "./tool-calls-summary-bar";
import { StreamingCursor } from "./streaming-cursor";
import { ArtifactCard } from "./artifact-card";
import { Button } from "@/components/ui/button";
import { Copy, Check, ThumbsUp, ThumbsDown, RefreshCw, FileText, FileCode2, FileSpreadsheet, FileImage, File, ExternalLink, FolderOpen, LayoutDashboard } from "lucide-react";
import { useCanvasStore } from "@/stores/canvas-store";
import type { A2UIDocument } from "@/lib/a2ui/types";
import { MemoryButton } from "./memory-button";
import { useConversationStore } from "@/stores/conversation-store";
import { sendUserFeedbackEvent } from "@/lib/telemetry/events";
import { parseArtifacts, hasArtifactMarkers } from "@/lib/artifacts/parser";
import type { ParsedArtifact } from "@/lib/artifacts/parser";
import { BASH_ARTIFACT_EXT, isValidSidebarEntry } from "@/lib/artifact-tracker";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "ExcelWrite", "ExcelEdit"]);

function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'sh', 'yml', 'yaml', 'json'].includes(ext))
    return <FileCode2 className="h-4 w-4 text-blue-500" />;
  if (['md', 'txt', 'doc', 'docx', 'pdf'].includes(ext))
    return <FileText className="h-4 w-4 text-orange-500" />;
  if (['xlsx', 'xls', 'csv'].includes(ext))
    return <FileSpreadsheet className="h-4 w-4 text-green-500" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext))
    return <FileImage className="h-4 w-4 text-purple-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function getExtBadge(path: string) {
  return path.split('.').pop()?.toUpperCase() || 'FILE';
}

function DocumentArtifactCard({ filePath, onClick }: { filePath: string; onClick?: (path: string) => void }) {
  const fileName = filePath.split('/').pop() || filePath;
  const canOpen = typeof window !== 'undefined' && 'electronAPI' in window;
  return (
    <button
      className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50 transition-colors group/doc"
      onClick={async () => {
        if (onClick) { onClick(filePath); return; }
        if (!canOpen) return;
        const api = window as unknown as { electronAPI: { openPath: (p: string) => Promise<string>; fileExists: (p: string) => Promise<boolean> } };
        // If the exact file exists, open it; otherwise open the containing folder
        const exists = await api.electronAPI.fileExists(filePath).catch(() => false);
        if (exists) {
          api.electronAPI.openPath(filePath);
        } else {
          const dir = filePath.split('/').slice(0, -1).join('/');
          if (dir) api.electronAPI.openPath(dir);
        }
      }}
    >
      {getFileIcon(filePath)}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" title={filePath}>{fileName}</div>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">{getExtBadge(filePath)}</span>
      <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover/doc:opacity-100 transition-opacity" />
    </button>
  );
}

const THINKING_WORDS = [
  "Pondering",
  "Wibbling",
  "Puzzling",
  "Noodling",
  "Mulling",
  "Conjuring",
  "Ruminating",
  "Percolating",
  "Brainstorming",
  "Scheming",
  "Tinkering",
  "Contemplating",
];

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "complete" | "error";
  startTime: number;
  endTime?: number;
}

interface AssistantMessageProps {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  isLoading?: boolean;
  isLastAssistantMessage?: boolean;
  onArtifactClick?: (path: string | ParsedArtifact) => void;
  onPreviewUrl?: (url: string) => void;
  onRetry?: () => void;
  /** Abort the active stream — only meaningful for the streaming message. */
  onCancel?: () => void;
  conversationId?: string;
  /** Inline canvas chips — A2UI docs the agent emitted during this turn. */
  inlineCanvases?: Array<{ id: string; title: string; doc: A2UIDocument }>;
  /** Surface this message is rendered in — drives where canvas chips reopen. */
  surfaceId?: 'chat' | 'cowork';
}

function CanvasChip({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left hover:bg-primary/10 transition-colors group/canvas"
    >
      <LayoutDashboard className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate text-foreground" title={title}>{title}</div>
      </div>
      <span className="text-[10px] font-mono text-primary/70 bg-primary/10 rounded px-1.5 py-0.5">CANVAS</span>
      <ExternalLink className="h-3 w-3 text-primary/60 opacity-0 group-hover/canvas:opacity-100 transition-opacity" />
    </button>
  );
}

export function AssistantMessage({
  content,
  thinking,
  toolCalls = [],
  isStreaming = false,
  isLoading = false,
  isLastAssistantMessage = false,
  onArtifactClick,
  onPreviewUrl,
  onRetry,
  onCancel,
  conversationId,
  inlineCanvases,
  surfaceId,
}: AssistantMessageProps) {
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setOpen = useCanvasStore((s) => s.setOpen);
  const [copied, setCopied] = useState(false);
  const updateConversationMetrics = useConversationStore((s) => s.updateConversationMetrics);
  const currentRating = useConversationStore((s) =>
    conversationId ? s.conversations.find((c) => c.id === conversationId)?.userRating : undefined
  );
  const [thinkingWordIndex, setThinkingWordIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_WORDS.length)
  );

  useEffect(() => {
    if (!isLoading || content) return;
    const interval = setInterval(() => {
      setThinkingWordIndex((i) => (i + 1) % THINKING_WORDS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [isLoading, content]);

  // Parse artifacts from content (skip during streaming to avoid partial matches)
  const parsed = useMemo(() => {
    if (!content || isStreaming) return null;
    if (!hasArtifactMarkers(content)) {
      // Try fallback heuristic only when not streaming
      return parseArtifacts(content);
    }
    return parseArtifacts(content);
  }, [content, isStreaming]);

  const hasArtifacts = parsed?.segments.some((s) => s.type === "artifact") ?? false;

  // Extract file paths from completed Write/Edit tool calls + binary artifacts
  // produced by Bash (e.g. the ppt plugin's generate_presentation.sh writing a .pptx).
  // The Bash scan reuses BASH_ARTIFACT_EXT so chips and the right-side panel agree
  // on what counts as a produced artifact.
  const writtenFiles = useMemo(() => {
    if (isStreaming) return [];
    const paths: string[] = [];
    const seen = new Set<string>();
    const add = (p: string | undefined) => {
      if (!p) return;
      const trimmed = p.replace(/['"]/g, "").trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      paths.push(trimmed);
    };
    for (const tc of toolCalls) {
      if (tc.status !== "complete") continue;
      if (WRITE_TOOLS.has(tc.name)) {
        add((tc.input.file_path || tc.input.path || tc.input.notebook_path) as string | undefined);
        continue;
      }
      if (tc.name === "Bash" && typeof tc.input.command === "string") {
        const cmd = tc.input.command;
        BASH_ARTIFACT_EXT.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = BASH_ARTIFACT_EXT.exec(cmd)) !== null) {
          const candidate = m[1];
          if (!candidate || candidate.length < 3 || candidate.startsWith(".")) continue;
          if (!isValidSidebarEntry(candidate)) continue;
          add(candidate);
        }
      }
    }
    return paths;
  }, [toolCalls, isStreaming]);

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleRate(rating: 1 | -1) {
    if (!conversationId) return;
    updateConversationMetrics(conversationId, { userRating: rating });
    const conv = useConversationStore.getState().conversations.find((c) => c.id === conversationId);
    sendUserFeedbackEvent({
      surface: conv?.surface ?? 'unknown',
      rating,
      model: conv?.tokenUsage?.model,
      taskType: conv?.effortEstimate?.taskType,
      domain: conv?.effortEstimate?.domain,
    });
  }

  return (
    <div className="flex mb-6 group animate-in fade-in duration-200">
      <div className="max-w-[90%] space-y-2">
        {/* Loading indicator — pulsing logo + rotating thinking word */}
        {isLoading && !content && (
          <div className="flex items-center gap-2 py-2">
            <img
              src="/starburst-logo.png"
              alt="Loading"
              width={22}
              height={22}
              className="loading-pulse"
            />
            <span className="text-sm text-muted-foreground thinking-word-fade">
              {THINKING_WORDS[thinkingWordIndex]}...
            </span>
          </div>
        )}

        {/* Thinking */}
        {thinking && (
          <ThinkingSection content={thinking} isComplete={!isStreaming} />
        )}

        {/* Tool calls summary bar */}
        {toolCalls.length > 0 && (
          <ToolCallsSummaryBar
            toolCalls={toolCalls}
            onArtifactClick={onArtifactClick}
            onPreviewUrl={onPreviewUrl}
            onCancel={isStreaming ? onCancel : undefined}
          />
        )}

        {/* Inline canvas chips — A2UI docs the agent rendered this turn */}
        {inlineCanvases && inlineCanvases.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            {inlineCanvases.map((c) => (
              <CanvasChip
                key={c.id}
                title={c.title}
                onOpen={() => {
                  // Push into THIS message's surface only — per-surface state
                  // means we no longer have to fan out to both.
                  const target = surfaceId ?? 'chat';
                  pushCanvas(target, c.doc);
                  setOpen(target, true);
                }}
              />
            ))}
          </div>
        )}

        {/* Document artifact cards for written files */}
        {writtenFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            {writtenFiles.map((fp) => (
              <DocumentArtifactCard key={fp} filePath={fp} onClick={onArtifactClick ? (p) => onArtifactClick(p) : undefined} />
            ))}
            {writtenFiles.length >= 2 && typeof window !== 'undefined' && 'electronAPI' in window && (
              <button
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                onClick={() => {
                  const api = (window as unknown as { electronAPI: { openPath: (p: string) => void } }).electronAPI;
                  // Open the containing folder of the first file
                  const dir = writtenFiles[0].split('/').slice(0, -1).join('/');
                  if (dir) api.openPath(dir);
                }}
                title="Open containing folder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Open folder
              </button>
            )}
          </div>
        )}

        {/* Content — render as segments if artifacts detected, else plain markdown */}
        {content && !hasArtifacts && (
          <div className="text-sm leading-relaxed">
            <MarkdownRenderer content={content} />
            {isStreaming && <StreamingCursor />}
          </div>
        )}

        {content && hasArtifacts && parsed && (
          <div className="text-sm leading-relaxed">
            {parsed.segments.map((segment, i) =>
              segment.type === "text" ? (
                <MarkdownRenderer key={i} content={segment.content} />
              ) : (
                <ArtifactCard
                  key={segment.artifact.id}
                  artifact={segment.artifact}
                  onClick={(artifact) => onArtifactClick?.(artifact)}
                />
              )
            )}
          </div>
        )}

        {/* Between-turn loading — shows starburst when streaming but no tools running and cursor idle */}
        {isStreaming && !isLoading && content && toolCalls.length > 0 && toolCalls.every((tc) => tc.status !== "running") && !content.endsWith("▊") && (
          <div className="flex items-center gap-2 py-2">
            <img
              src="/starburst-logo.png"
              alt="Working"
              width={18}
              height={18}
              className="loading-pulse"
            />
            <span className="text-xs text-muted-foreground thinking-word-fade">
              {THINKING_WORDS[thinkingWordIndex]}...
            </span>
          </div>
        )}

        {/* Actions — visible on hover */}
        {!isStreaming && !isLoading && content && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            {isLastAssistantMessage && onRetry && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onRetry}
                title="Retry"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            <MemoryButton content={content} conversationId={conversationId} />
            {/* Rating buttons — only on last assistant message */}
            {isLastAssistantMessage && conversationId && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 transition-colors ${currentRating === 1 ? "text-green-500" : "text-muted-foreground hover:text-green-500"}`}
                  onClick={() => handleRate(1)}
                  title="This was helpful"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 transition-colors ${currentRating === -1 ? "text-red-500" : "text-muted-foreground hover:text-red-500"}`}
                  onClick={() => handleRate(-1)}
                  title="This was not helpful"
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
