/**
 * PDF text extraction using pdfjs-dist.
 */
import type { ExtractionResult } from './types';

export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pageCount = doc.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')
      .trim();
    if (pageText) {
      pages.push(`--- Page ${i} ---\n${pageText}`);
    }
  }

  return {
    text: pages.join('\n\n'),
    pageCount,
    metadata: { type: 'pdf' },
  };
}
