"use client";

import { useRef, useCallback, KeyboardEvent, ChangeEvent, ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowUp, Square, X, FileText, ImageIcon, File } from "lucide-react";
import type { AttachmentFile } from "@/components/shared/attachment-menu";

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
  /** Attachments to display as chips and clear on submit */
  attachments?: AttachmentFile[];
  onRemoveAttachment?: (index: number) => void;
}

function AttachmentIcon({ category }: { category: string }) {
  if (category === 'image') return <ImageIcon className="h-3 w-3" />;
  if (category === 'document') return <File className="h-3 w-3" />;
  return <FileText className="h-3 w-3" />;
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
  attachments,
  onRemoveAttachment,
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
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="min-h-[36px] max-h-[200px] resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-3 pb-0"
            style={{ opacity: isStreaming ? 0.6 : 1 }}
          />
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((att, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <AttachmentIcon category={att.category} />
                  {att.name}
                  {onRemoveAttachment && (
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(i)}
                      className="hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1">
              {extraControls}
            </div>
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
    </div>
  );
}
