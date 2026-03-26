/**
 * Shared types for document extraction.
 */

export interface ExtractionResult {
  /** Extracted plain text content */
  text: string;
  /** Number of pages (PDF, PPTX) or sheets (XLSX) */
  pageCount?: number;
  /** Additional metadata about the document */
  metadata?: Record<string, unknown>;
}

/** Attachment categories for classification */
export type AttachmentCategory =
  | 'image'
  | 'document'
  | 'text'
  | 'spreadsheet'
  | 'presentation'
  | 'audio'
  | 'video';
