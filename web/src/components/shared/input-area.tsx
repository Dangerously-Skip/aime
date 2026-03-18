"use client";

import { useRef, useCallback, KeyboardEvent, ChangeEvent, ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp, Square } from "lucide-react";

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  maxHeight?: number;
  extraControls?: ReactNode;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  onAbort,
  isStreaming = false,
  placeholder = "Send a message...",
  disabled = false,
  maxHeight = 200,
  extraControls,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) {
          onAbort?.();
        } else if (value.trim()) {
          onSubmit(value.trim());
        }
      }
    },
    [value, isStreaming, onSubmit, onAbort]
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // Auto-resize
      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    },
    [onChange, maxHeight]
  );

  function handleButtonClick() {
    if (isStreaming) {
      onAbort?.();
    } else if (value.trim()) {
      onSubmit(value.trim());
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="min-h-[36px] max-h-[200px] resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-2"
              style={{ opacity: isStreaming ? 0.6 : 1 }}
            />
          </div>
          {extraControls}
          <Button
            size="icon"
            className={`h-8 w-8 shrink-0 rounded-lg ${
              isStreaming
                ? "bg-destructive hover:bg-destructive/80"
                : "bg-primary hover:bg-primary/80"
            }`}
            onClick={handleButtonClick}
            disabled={!isStreaming && !value.trim()}
          >
            {isStreaming ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
