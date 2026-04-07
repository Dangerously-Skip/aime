"use client";

import { FileText, ImageIcon, File, RotateCw } from "lucide-react";

interface AttachmentInfo {
  name: string;
  category: string;
}

interface UserMessageProps {
  content: string;
  timestamp?: number;
  attachments?: AttachmentInfo[];
  isAutoContinue?: boolean;
}

function AttachmentChip({ name, category }: AttachmentInfo) {
  const Icon = category === 'image' ? ImageIcon : category === 'document' ? File : FileText;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background/50 px-2 py-0.5 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {name}
    </span>
  );
}

/** Strip injected <document> blocks from display content */
function stripDocumentBlocks(text: string): string {
  return text.replace(/\n\n<document name="[^"]*">[\s\S]*?<\/document>/g, '').trim();
}

export function UserMessage({ content, attachments, isAutoContinue }: UserMessageProps) {
  const displayContent = stripDocumentBlocks(content);

  if (isAutoContinue) {
    return (
      <div className="flex justify-center mb-4">
        <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          <RotateCw className="h-3 w-3" />
          Auto-continued
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end mb-6">
      <div className="max-w-[75%]">
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end mb-1.5">
            {attachments.map((att, i) => (
              <AttachmentChip key={i} name={att.name} category={att.category} />
            ))}
          </div>
        )}
        <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
          <p className="whitespace-pre-wrap break-words leading-relaxed">{displayContent}</p>
        </div>
      </div>
    </div>
  );
}
