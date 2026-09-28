import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { stripDocumentBlocks } from "@/components/shared/user-message";

/**
 * The attachments each sent message went out with, by message id.
 *
 * The transcript stores attachment NAMES only (bodies are base64 and would eat
 * the localStorage budget), so a Retry or an Edit used to resend the question
 * with its files silently missing. Kept in memory: after a restart the
 * extracted `<document>` text already in the message is what survives.
 */
const sent = new Map<string, AttachmentFile[]>();

export function rememberTurnAttachments(messageId: string, attachments: AttachmentFile[]): void {
  if (attachments.length > 0) sent.set(messageId, attachments);
}

export function turnAttachmentsFor(messageId: string): AttachmentFile[] | undefined {
  return sent.get(messageId);
}

const DOCUMENT_BLOCK = /\n\n<document name="[^"]*">[\s\S]*?<\/document>/g;

/**
 * What to resend for a user message: its text and its files. With the files in
 * hand the extracted `<document>` blocks are dropped (the server re-extracts
 * them); without, they are the only copy of the document left, so they stay.
 */
export function resendPayload(
  message: { id: string; content: string },
  editedText?: string,
): { text: string; attachments: AttachmentFile[] } {
  const attachments = turnAttachmentsFor(message.id) ?? [];
  const typed = editedText ?? stripDocumentBlocks(message.content);
  if (attachments.length > 0) return { text: typed, attachments };
  const blocks = message.content.match(DOCUMENT_BLOCK)?.join("") ?? "";
  return { text: typed + blocks, attachments };
}
