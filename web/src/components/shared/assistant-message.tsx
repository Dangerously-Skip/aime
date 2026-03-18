"use client";

import { useState, useMemo, useEffect } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThinkingSection } from "./thinking-section";
import { ToolCallsSummaryBar } from "./tool-calls-summary-bar";
import { StreamingCursor } from "./streaming-cursor";
import { ArtifactCard } from "./artifact-card";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { MemoryButton } from "./memory-button";
import { parseArtifacts, hasArtifactMarkers } from "@/lib/artifacts/parser";
import type { ParsedArtifact } from "@/lib/artifacts/parser";

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
  onArtifactClick?: (path: string | ParsedArtifact) => void;
  onPreviewUrl?: (url: string) => void;
  conversationId?: string;
}

export function AssistantMessage({
  content,
  thinking,
  toolCalls = [],
  isStreaming = false,
  isLoading = false,
  onArtifactClick,
  onPreviewUrl,
  conversationId,
}: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
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

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
          />
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
            <MemoryButton content={content} conversationId={conversationId} />
          </div>
        )}
      </div>
    </div>
  );
}
