/**
 * Writing a rendered document to disk (P4.2).
 *
 * Split from the tool handler so the naming and path confinement are testable
 * without Electron.
 *
 * The HTML is ALWAYS written; the PDF only when Electron can print. That
 * asymmetry is deliberate: outside the packaged app (`next dev`, or a headless
 * run) there is no Chromium to print with, and returning nothing would leave the
 * user with no document at all. A themed HTML file opens in any browser and
 * prints from there, so the degraded path is still useful — and the tool says
 * which one happened rather than implying a PDF exists.
 *
 * "Can we print?" is NOT decided here. The DocumentCreate handler answers it by
 * asking whether it has a connected client to relay through (`onDocumentPrint`,
 * see pending-documents). A `canPrintBridge`-style duck-type used to live in this
 * file with no caller at all, so a reader tracing PDF availability found it first
 * and followed a dead branch; it is gone rather than left as a decoy.
 */
import { slugifySkillName } from '../skills/create';
import { resolveContainedChild, type PathFlavour } from '../path-containment';

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
 *
 * Containment is the shared rule too (`@/lib/path-containment`), rather than the
 * third copy of a string-prefix check that hardcoded '/' and could not fail while
 * its only input was a slug.
 */
export function resolveDocumentTarget(
  baseDir: string,
  title: unknown,
  /** Test seam — see `PathFlavour`. Production always uses the host's. */
  opts: { flavour?: PathFlavour } = {},
): TargetResult {
  const slug = slugifySkillName(title);
  if (!slug.ok) return { ok: false, error: slug.error };

  const contained = resolveContainedChild(baseDir, slug.slug, {
    error: 'Resolved document path escapes the output directory.',
    flavour: opts.flavour,
  });
  if (!contained.ok) return { ok: false, error: contained.error };

  return {
    ok: true,
    target: {
      dir: contained.base,
      slug: slug.slug,
      htmlPath: `${contained.path}.html`,
      pdfPath: `${contained.path}.pdf`,
    },
  };
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
