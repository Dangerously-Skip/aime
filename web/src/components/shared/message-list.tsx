"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore } from "@/stores/settings-store";
import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

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
}

interface MessageListProps {
  messages: Message[];
  className?: string;
}

export function MessageList({ messages, className = "" }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const chatFont = useSettingsStore((s) => s.chatFont);
  const fontClass = FONT_CLASS_MAP[chatFont] || "";

  const scrollToBottom = useCallback(
    (force = false) => {
      if (force || !userScrolledUp) {
        endRef.current?.scrollIntoView({ behavior: "instant" });
      }
    },
    [userScrolledUp]
  );

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Track user scroll position
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const threshold = 50;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setUserScrolledUp(!atBottom);
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`flex-1 overflow-y-auto px-6 py-6 ${fontClass} ${className}`}
    >
      <div className="max-w-3xl mx-auto">
      {messages.map((msg) =>
        msg.role === "user" ? (
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
          />
        ) : null
      )}
      <div ref={endRef} />
      </div>
    </div>
  );
}
