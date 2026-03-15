"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
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
}

interface MessageListProps {
  messages: Message[];
  className?: string;
  onQuestionAnswered?: (toolUseId: string, answers: Record<string, string>) => void;
  onArtifactClick?: (pathOrArtifact: string | ParsedArtifact) => void;
  conversationId?: string;
}

export function MessageList({ messages, className = "", onQuestionAnswered, onArtifactClick, conversationId }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const chatFont = useSettingsStore((s) => s.chatFont);
  const fontClass = FONT_CLASS_MAP[chatFont] || "";

  // Granular scroll key — changes on message count, last message content length, and tool call count
  const lastMsg = messages[messages.length - 1];
  const scrollKey = useMemo(
    () =>
      `${messages.length}-${lastMsg?.content?.length ?? 0}-${lastMsg?.toolCalls?.length ?? 0}`,
    [messages.length, lastMsg?.content?.length, lastMsg?.toolCalls?.length]
  );

  // Auto-scroll on content changes
  useEffect(() => {
    if (!userScrolledUp) {
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [scrollKey, userScrolledUp]);

  // Track user scroll position
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const threshold = 50;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setUserScrolledUp(!atBottom);
  }

  const handleScrollToBottom = useCallback(() => {
    setUserScrolledUp(false);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`relative flex-1 overflow-y-auto px-6 py-6 ${fontClass} ${className}`}
    >
      <div className="max-w-3xl mx-auto">
      {messages.map((msg) =>
        msg.questionData ? (
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
          />
        ) : msg.role === "assistant" ? (
          <AssistantMessage
            key={msg.id}
            content={msg.content}
            thinking={msg.thinking}
            toolCalls={msg.toolCalls}
            isStreaming={msg.isStreaming}
            isLoading={msg.isLoading}
            onArtifactClick={onArtifactClick}
            conversationId={conversationId}
          />
        ) : null
      )}
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
