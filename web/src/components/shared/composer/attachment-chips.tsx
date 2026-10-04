"use client";

import { X, FileText, ImageIcon, File, FileSpreadsheet, Presentation, Music, Video } from "lucide-react";
import type { AttachmentFile } from "@/components/shared/attachment-menu";

function AttachmentIcon({ category }: { category: AttachmentFile["category"] }) {
  switch (category) {
    case "image": return <ImageIcon className="h-3 w-3" aria-hidden="true" />;
    case "document": return <File className="h-3 w-3" aria-hidden="true" />;
    case "spreadsheet": return <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />;
    case "presentation": return <Presentation className="h-3 w-3" aria-hidden="true" />;
    case "audio": return <Music className="h-3 w-3" aria-hidden="true" />;
    case "video": return <Video className="h-3 w-3" aria-hidden="true" />;
    default: return <FileText className="h-3 w-3" aria-hidden="true" />;
  }
}

/**
 * What is about to be sent with the message. Images show as thumbnails — a
 * pasted screenshot named `image.png` is otherwise indistinguishable from the
 * last one — and everything else as a chip with a type icon.
 */
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: AttachmentFile[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-4 pt-2" aria-label="Attachments">
      {attachments.map((att, i) =>
        att.category === "image" && att.content?.startsWith("data:image/") ? (
          <li key={`${att.name}-${i}`} className="relative group/thumb">
            <img
              src={att.content}
              alt={att.name}
              className="h-12 w-12 rounded-md object-cover border border-border"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${att.name}`}
              title={`Remove ${att.name}`}
              className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-muted border border-border flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              <X className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          </li>
        ) : (
          <li
            key={`${att.name}-${i}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            <AttachmentIcon category={att.category} />
            <span className="max-w-[200px] truncate">{att.name}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${att.name}`}
              title={`Remove ${att.name}`}
              className="hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
