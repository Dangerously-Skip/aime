/**
 * Word document (.docx) text extraction using mammoth.
 */
import type { ExtractionResult } from './types';

export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });

  return {
    text: result.value,
    metadata: {
      type: 'docx',
      warnings: result.messages?.length ?? 0,
    },
  };
}
