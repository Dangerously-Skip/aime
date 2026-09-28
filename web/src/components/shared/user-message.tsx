"use client";

import { memo, useState, type KeyboardEvent } from "react";
import { FileText, ImageIcon, File, RotateCw, Copy, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AttachmentInfo {
  name: string;
  category: string;
}

interface UserMessageProps {
  /** The message id, handed back to `onEdit` so the list can pass one stable callback. */
  id?: string;
  content: string;
  timestamp?: number;
  attachments?: AttachmentInfo[];
  isAutoContinue?: boolean;
  /**
   * Replace this question with an edited one and ask again. Absent while a turn
   * is running (editing then would race the reply being written).
   */
  onEdit?: (id: string, text: string) => void;
}

function AttachmentChip({ name, category }: AttachmentInfo) {
  const Icon = category === 'image' ? ImageIcon : category === 'document' ? File : FileText;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background/50 px-2 py-0.5 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {name}
    </span>
  );
}

/** Strip injected <document> blocks from display content */
export function stripDocumentBlocks(text: string): string {
  return text.replace(/\n\n<document name="[^"]*">[\s\S]*?<\/document>/g, '').trim();
}

export const UserMessage = memo(function UserMessage({ id, content, attachments, isAutoContinue, onEdit }: UserMessageProps) {
  const displayContent = stripDocumentBlocks(content);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayContent);

  if (isAutoContinue) {
    return (
      <div className="flex justify-center mb-4">
        <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          <RotateCw className="h-3 w-3" aria-hidden="true" />
          Auto-continued
        </div>
      </div>
    );
  }

  function handleCopy() {
    void navigator.clipboard?.writeText(displayContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function startEdit() {
    setDraft(displayContent);
    setEditing(true);
  }

  function saveEdit() {
    const text = draft.trim();
    if (!text || !id || !onEdit) return;
    setEditing(false);
    if (text !== displayContent) onEdit(id, text);
  }

  function handleEditKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }

  return (
    <div className="flex justify-end mb-6 group/user">
      <div className={editing ? "w-full max-w-[75%]" : "max-w-[75%]"}>
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end mb-1.5">
            {attachments.map((att, i) => (
              <AttachmentChip key={i} name={att.name} category={att.category} />
            ))}
          </div>
        )}
        {editing ? (
          <div className="rounded-2xl border border-border bg-card p-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKey}
              aria-label="Edit message"
              autoFocus
              rows={3}
              className="min-h-[72px] max-h-[240px] resize-none border-0 bg-transparent dark:bg-transparent text-sm focus-visible:ring-0"
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={saveEdit} disabled={!draft.trim()}>
                Save and send
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
              <p className="whitespace-pre-wrap break-words leading-relaxed">{displayContent}</p>
            </div>
            {/* Hover to reveal, and reachable by keyboard: focus-within shows them. */}
            <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100 focus-within:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy message"}
                title="Copy"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              </Button>
              {onEdit && id && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={startEdit}
                  aria-label="Edit and resend"
                  title="Edit and resend"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
