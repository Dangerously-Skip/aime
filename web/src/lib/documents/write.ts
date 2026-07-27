/**
 * Writing a rendered document to disk (P4.2).
 *
 * Split from the tool handler so the naming, path confinement and the
 * PDF-availability decision are testable without Electron.
 *
 * The HTML is ALWAYS written; the PDF only when Electron can print. That
 * asymmetry is deliberate: outside the packaged app (`next dev`, or a headless
 * run) there is no Chromium to print with, and returning nothing would leave the
 * user with no document at all. A themed HTML file opens in any browser and
 * prints from there, so the degraded path is still useful — and the tool says
 * which one happened rather than implying a PDF exists.
 */
import { slugifySkillName } from '../skills/create';

export interface DocumentTarget {
  /** Directory the document is written into. */
  dir: string;
  /** Filename stem, already slugified. */
  slug: string;
  htmlPath: string;
  pdfPath: string;
}

export type TargetResult = { ok: true; target: DocumentTarget } | { ok: false; error: string };

/**
 * Resolve where a document goes, proving the result stays inside `baseDir`.
 *
 * Reuses the skill slugifier: a document title is a human display name with the
 * same problem — "Q3 Board Pack" must become a filename, and `../../etc` must not
 * escape. Sharing it means one tested rule rather than two similar ones.
 */
export function resolveDocumentTarget(baseDir: string, title: unknown): TargetResult {
  const slug = slugifySkillName(title);
  if (!slug.ok) return { ok: false, error: slug.error };

  const base = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  const stem = `${base}${slug.slug}`;
  if (!stem.startsWith(base) || stem.slice(base.length).includes('/')) {
    return { ok: false, error: 'Resolved document path escapes the output directory.' };
  }

  return {
    ok: true,
    target: {
      dir: baseDir,
      slug: slug.slug,
      htmlPath: `${stem}.html`,
      pdfPath: `${stem}.pdf`,
    },
  };
}

export interface PrintBridge {
  printPdf: (args: {
    html: string;
    outputPath: string;
    printOptions: Record<string, unknown>;
  }) => Promise<{ ok: boolean; path?: string; error?: string; bytes?: number }>;
}

/**
 * Is a real print pipeline available? False under `next dev` and in any headless
 * run, which is the case the honest fallback exists for.
 */
export function canPrintPdf(bridge: unknown): bridge is PrintBridge {
  return !!bridge && typeof (bridge as PrintBridge).printPdf === 'function';
}

/** What the model is told, so it can describe the outcome accurately. */
export function describeOutcome(opts: {
  title: string;
  htmlPath: string;
  pdfPath?: string;
  pdfError?: string;
}): string {
  if (opts.pdfPath) {
    return `Saved "${opts.title}" as a PDF at ${opts.pdfPath} (themed HTML alongside it at ${opts.htmlPath}).`;
  }
  const why = opts.pdfError
    ? ` PDF rendering failed: ${opts.pdfError}`
    : ' PDF rendering needs the desktop app, so only the HTML was written.';
  return `Saved "${opts.title}" as themed HTML at ${opts.htmlPath}. It opens and prints from any browser.${why}`;
}
