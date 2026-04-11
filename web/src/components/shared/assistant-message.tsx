"use client";

import { useState, useMemo, useEffect } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThinkingSection } from "./thinking-section";
import { ToolCallsSummaryBar } from "./tool-calls-summary-bar";
import { StreamingCursor } from "./streaming-cursor";
import { ArtifactCard } from "./artifact-card";
import { Button } from "@/components/ui/button";
import { Copy, Check, ThumbsUp, ThumbsDown, RefreshCw } from "lucide-react";
import { MemoryButton } from "./memory-button";
import { useConversationStore } from "@/stores/conversation-store";
import { sendUserFeedbackEvent } from "@/lib/telemetry/events";
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
  isLastAssistantMessage?: boolean;
  onArtifactClick?: (path: string | ParsedArtifact) => void;
  onPreviewUrl?: (url: string) => void;
  onRetry?: () => void;
  conversationId?: string;
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
  conversationId,
}: AssistantMessageProps) {
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
