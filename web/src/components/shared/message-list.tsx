"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import { QuestionCard } from "./question-card";
import { ArrowDown } from "lucide-react";
import type { ParsedArtifact } from "@/lib/artifacts/parser";

const FONT_CLASS_MAP: Record<string, string> = {
  default: "chat-font-default",
  sans: "chat-font-sans",
  mono: "chat-font-mono",
  system: "chat-font-system",
};

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "complete" | "error";
  startTime: number;
  endTime?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: string;
  isStreaming?: boolean;
  isLoading?: boolean;
  questionData?: unknown;
  questionToolUseId?: string;
  questionAnswered?: boolean;
  isAutoContinue?: boolean;
  attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' }>;
  inlineCanvases?: Array<{ id: string; title: string; doc: import("@/lib/a2ui/types").A2UIDocument }>;
}

interface MessageListProps {
  messages: Message[];
  className?: string;
  onQuestionAnswered?: (toolUseId: string, answers: Record<string, string>) => void;
  onArtifactClick?: (pathOrArtifact: string | ParsedArtifact) => void;
  onPreviewUrl?: (url: string) => void;
  onRetry?: () => void;
  /** Cancels the active stream — wired to streamRegistry.abort by the surface. */
  onCancel?: () => void;
  conversationId?: string;
}

export function MessageList({ messages, className = "", onQuestionAnswered, onArtifactClick, onPreviewUrl, onRetry, onCancel, conversationId }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const userScrolledUpRef = useRef(false);
  const chatFont = useSettingsStore((s) => s.chatFont);
  const fontClass = FONT_CLASS_MAP[chatFont] || "";

  // Auto-scroll via ResizeObserver — fires on any content size change
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        requestAnimationFrame(() => {
          endRef.current?.scrollIntoView({ behavior: "instant" });
        });
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Scroll to bottom on conversation switch (messages go from 0 to >0)
  useEffect(() => {
    if (messages.length > 0) {
      userScrolledUpRef.current = false;
      setUserScrolledUp(false);
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [messages.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track user scroll position
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const threshold = 50;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    const scrolledUp = !atBottom;
    setUserScrolledUp(scrolledUp);
    userScrolledUpRef.current = scrolledUp;
  }

  const handleScrollToBottom = useCallback(() => {
    setUserScrolledUp(false);
    userScrolledUpRef.current = false;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`relative flex-1 overflow-y-auto px-6 py-6 ${fontClass} ${className}`}
    >
      <div ref={contentRef} className="max-w-3xl mx-auto">
      {messages.map((msg, idx) => {
        const isLastAssistant = msg.role === "assistant" && !msg.isStreaming && !msg.isLoading &&
          messages.slice(idx + 1).every((m) => m.role !== "assistant" || !!m.questionData);
        return msg.questionData ? (
          <QuestionCard
            key={msg.id}
            toolUseId={msg.questionToolUseId || msg.id}
            questions={msg.questionData as Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }>}
            answered={msg.questionAnswered}
            onAnswer={onQuestionAnswered}
          />
        ) : msg.role === "user" ? (
          <UserMessage
            key={msg.id}
            content={msg.content}
            timestamp={msg.timestamp}
            attachments={msg.attachments}
            isAutoContinue={msg.isAutoContinue}
          />
        ) : msg.role === "assistant" ? (
          <AssistantMessage
            key={msg.id}
            content={msg.content}
            thinking={msg.thinking}
            toolCalls={msg.toolCalls}
            isStreaming={msg.isStreaming}
            isLoading={msg.isLoading}
            isLastAssistantMessage={isLastAssistant}
            onArtifactClick={onArtifactClick}
            onPreviewUrl={onPreviewUrl}
            onRetry={isLastAssistant ? onRetry : undefined}
            onCancel={msg.isStreaming ? onCancel : undefined}
            conversationId={conversationId}
            inlineCanvases={msg.inlineCanvases}
          />
        ) : null;
      })}
      <div ref={endRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {userScrolledUp && (
        <button
          onClick={handleScrollToBottom}
          className="sticky bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-card border border-border shadow-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowDown className="h-3 w-3" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
