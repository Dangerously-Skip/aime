/**
 * Central document extraction dispatch.
 * Routes files to the appropriate extractor based on type/extension.
 */
import type { ExtractionResult, AttachmentCategory } from './types';

export type { ExtractionResult, AttachmentCategory } from './types';

/**
 * Extract text from a document attachment.
 * @param name - Original filename
 * @param content - Base64-encoded file content (or raw text for text files)
 * @param mimeType - MIME type of the file
 * @param category - Classified attachment category
 * @param filePath - Optional path to file on disk (for large uploads)
 */
export async function extractDocument(
  name: string,
  content: string,
  mimeType: string,
  category: AttachmentCategory,
  filePath?: string,
): Promise<ExtractionResult> {
  // Get buffer from content or filePath
  let buffer: Buffer;
  if (filePath) {
    const fs = await import('fs');
    buffer = fs.readFileSync(filePath);
  } else if (category === 'text') {
    // Text files are sent as raw strings, not base64
    return { text: content, metadata: { type: 'text' } };
  } else {
    buffer = Buffer.from(content, 'base64');
  }

  const ext = name.split('.').pop()?.toLowerCase() || '';

  switch (category) {
    case 'document': {
      if (ext === 'pdf' || mimeType === 'application/pdf') {
        const { extractPdf } = await import('./pdf');
        return extractPdf(buffer);
      }
      if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { extractDocx } = await import('./docx');
        return extractDocx(buffer);
      }
      // Fallback: try to read as text
      return { text: buffer.toString('utf-8'), metadata: { type: 'document' } };
    }

    case 'spreadsheet': {
      const { extractXlsx } = await import('./xlsx');
      return extractXlsx(buffer);
    }

    case 'presentation': {
      const { extractPptx } = await import('./pptx');
      return extractPptx(buffer);
    }

    case 'audio': {
      const { extractAudio } = await import('./audio');
      return extractAudio(buffer, name);
    }

    case 'video': {
      const { extractVideo } = await import('./video');
      return extractVideo(buffer, name);
    }

    case 'image':
      return {
        text: `[Image: ${name}]`,
        metadata: { type: 'image' },
      };

    case 'text':
      return { text: content, metadata: { type: 'text' } };

    default:
      return { text: `[Unsupported file type: ${name}]`, metadata: { type: 'unknown' } };
  }
}
