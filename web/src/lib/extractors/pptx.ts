/**
 * PowerPoint (.pptx) text extraction using jszip.
 * Parses slide XML to extract text from <a:t> elements and notes.
 */
import type { ExtractionResult } from './types';

export async function extractPptx(buffer: Buffer): Promise<ExtractionResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);

  // Find slide files (ppt/slides/slide1.xml, slide2.xml, etc.)
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

  const slides: string[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.files[slideFiles[i]].async('text');
    // Extract all <a:t> text elements
    const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
    const slideText = textMatches
      .map(m => m.replace(/<\/?a:t>/g, ''))
      .join(' ')
      .trim();

    // Try to get notes for this slide
    const notesFile = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    let notesText = '';
    if (zip.files[notesFile]) {
      const notesXml = await zip.files[notesFile].async('text');
      const notesMatches = notesXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      notesText = notesMatches
        .map(m => m.replace(/<\/?a:t>/g, ''))
        .join(' ')
        .trim();
    }

    const parts = [`--- Slide ${i + 1} ---`];
    if (slideText) parts.push(slideText);
    if (notesText) parts.push(`[Notes: ${notesText}]`);

    if (slideText || notesText) {
      slides.push(parts.join('\n'));
    }
  }

  return {
    text: slides.join('\n\n'),
    pageCount: slideFiles.length,
    metadata: { type: 'pptx' },
  };
}
