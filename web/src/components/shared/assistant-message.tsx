"use client";

import { useState } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ThinkingSection } from "./thinking-section";
import { ToolCallCard } from "./tool-call-card";
import { StreamingCursor } from "./streaming-cursor";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

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
}

export function AssistantMessage({
  content,
  thinking,
  toolCalls = [],
  isStreaming = false,
  isLoading = false,
}: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex mb-6 group animate-in fade-in duration-200">
      <div className="max-w-[90%] space-y-2">
        {/* Loading indicator — pulsing starburst logo */}
        {isLoading && !content && (
          <div className="py-2">
            <img
              src="/starburst-logo.png"
              alt="Loading"
              width={22}
              height={22}
              className="loading-pulse"
            />
          </div>
        )}

        {/* Thinking */}
        {thinking && (
          <ThinkingSection content={thinking} isComplete={!isStreaming} />
        )}

        {/* Content */}
        {content && (
          <div className="text-sm leading-relaxed">
            <MarkdownRenderer content={content} />
            {isStreaming && <StreamingCursor />}
          </div>
        )}

        {/* Tool calls */}
        {toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {toolCalls.map((tool) => (
              <ToolCallCard
                key={tool.id}
                name={tool.name}
                input={tool.input}
                output={tool.output}
                status={tool.status}
                startTime={tool.startTime}
                endTime={tool.endTime}
              />
            ))}
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
          </div>
        )}
      </div>
    </div>
  );
}
