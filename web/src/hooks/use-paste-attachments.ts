"use client";

import { useCallback, type ClipboardEvent } from "react";
import { processFiles, type AttachmentFile } from "@/components/shared/attachment-menu";

/**
 * Should this paste become attachments, or ordinary text?
 *
 * Files on the clipboard are not enough on their own to decide. Office apps put
 * a rendered IMAGE of the selection next to its text, and a user pasting a
 * paragraph from Word wants the paragraph; Finder puts the file next to its
 * NAME as text, and a user pasting a copied file wants the file. So: attach when
 * there is no text, or when the text is nothing but the files' own names.
 */
export function pasteWantsFiles(files: ArrayLike<File>, text: string): boolean {
  if (files.length === 0) return false;
  const trimmed = text.trim();
  if (!trimmed) return true;
  const names = new Set(Array.from(files, (f) => f.name));
  return trimmed.split(/\r?\n/).every((line) => names.has(line.trim()));
}

/**
 * Paste a screenshot or a copied file into a composer and it arrives as an
 * attachment — the same path the attachment menu and drag-and-drop use
 * (`processFiles`), so size limits and the large-file upload apply unchanged.
 */
export function usePasteAttachments(onFile: (file: AttachmentFile) => void) {
  return useCallback(
    (e: ClipboardEvent<HTMLElement>) => {
      const data = e.clipboardData;
      if (!data?.files || data.files.length === 0) return;
      if (!pasteWantsFiles(data.files, data.getData("text/plain") ?? "")) return;
      e.preventDefault();
      processFiles(data.files, onFile);
    },
    [onFile],
  );
}
