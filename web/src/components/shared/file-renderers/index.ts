import type { ComponentType } from "react";
import dynamic from "next/dynamic";

/** Props every renderer receives. */
export interface RendererProps {
  content: string;
  encoding: "utf-8" | "base64";
  ext: string;
  name: string;
  path: string;
  onOpenExternal: (path: string) => void;
}

/** Extensions that are truly un-renderable — skip file read entirely. */
export const UNPRINTABLE_BINARY_EXTS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".7z", ".rar",
  ".mp3", ".wav", ".ogg", ".flac", ".aac",
  ".mp4", ".webm", ".avi", ".mov", ".mkv",
  ".dmg", ".iso", ".bin", ".exe", ".dll", ".so", ".dylib",
]);

/** Image extensions that get routed to the image renderer. */
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

/** Extensions with dedicated rich renderers (loaded lazily). */
const RICH_RENDERERS: Record<string, () => Promise<{ default: ComponentType<RendererProps> }>> = {
  ".pdf": () => import("./pdf-renderer").then(m => ({ default: m.PdfRenderer as unknown as ComponentType<RendererProps> })),
  ".docx": () => import("./docx-renderer").then(m => ({ default: m.DocxRenderer as unknown as ComponentType<RendererProps> })),
  ".doc": () => import("./docx-renderer").then(m => ({ default: m.DocxRenderer as unknown as ComponentType<RendererProps> })),
  ".xlsx": () => import("./xlsx-renderer").then(m => ({ default: m.XlsxRenderer as unknown as ComponentType<RendererProps> })),
  ".xls": () => import("./xlsx-renderer").then(m => ({ default: m.XlsxRenderer as unknown as ComponentType<RendererProps> })),
  ".pptx": () => import("./pptx-renderer").then(m => ({ default: m.PptxRenderer as unknown as ComponentType<RendererProps> })),
  ".ppt": () => import("./pptx-renderer").then(m => ({ default: m.PptxRenderer as unknown as ComponentType<RendererProps> })),
  ".csv": () => import("./csv-renderer").then(m => ({ default: m.CsvRenderer as unknown as ComponentType<RendererProps> })),
  ".tsv": () => import("./csv-renderer").then(m => ({ default: m.CsvRenderer as unknown as ComponentType<RendererProps> })),
  ".mmd": () => import("./mermaid-renderer").then(m => ({ default: m.MermaidRenderer as unknown as ComponentType<RendererProps> })),
  ".mermaid": () => import("./mermaid-renderer").then(m => ({ default: m.MermaidRenderer as unknown as ComponentType<RendererProps> })),
  // A generated deck arrived here as markup with an "Open" button to a browser.
  // The deck was fine; there was no way to look at it without leaving the app.
  ".html": () => import("./html-renderer").then(m => ({ default: m.HtmlRenderer as unknown as ComponentType<RendererProps> })),
  ".htm": () => import("./html-renderer").then(m => ({ default: m.HtmlRenderer as unknown as ComponentType<RendererProps> })),
};

/** Markdown extensions — rendered as rich markdown instead of raw code. */
const MARKDOWN_EXTS = new Set([".md", ".mdx"]);

// Build lazy components from RICH_RENDERERS
const lazyRichRenderers: Record<string, ComponentType<RendererProps>> = {};
for (const [ext, loader] of Object.entries(RICH_RENDERERS)) {
  lazyRichRenderers[ext] = dynamic(loader, { ssr: false });
}

// Lazy-load the image renderer
const LazyImageRenderer = dynamic(
  () => import("./image-renderer").then(m => ({ default: m.ImageRenderer as unknown as ComponentType<RendererProps> })),
  { ssr: false }
);

// Lazy-load markdown preview renderer
const LazyMarkdownPreviewRenderer = dynamic(
  () => import("./markdown-preview-renderer").then(m => ({ default: m.MarkdownPreviewRenderer as unknown as ComponentType<RendererProps> })),
  { ssr: false }
);

// Lazy-load code renderer (lightweight, but keeps pattern consistent)
const LazyCodeRenderer = dynamic(
  () => import("./code-renderer").then(m => ({ default: m.CodeRenderer as unknown as ComponentType<RendererProps> })),
  { ssr: false }
);

// Lazy-load binary fallback
const LazyBinaryFallback = dynamic(
  () => import("./binary-fallback").then(m => ({ default: m.BinaryFallback as unknown as ComponentType<RendererProps> })),
  { ssr: false }
);

/**
 * Returns the appropriate renderer component for the given file extension.
 * Renderers are lazy-loaded so heavy libraries only ship when needed.
 */
export function getRenderer(ext: string): ComponentType<RendererProps> {
  // Rich format renderers (PDF, Office, CSV, Mermaid)
  if (lazyRichRenderers[ext]) return lazyRichRenderers[ext];

  // Image renderer
  if (IMAGE_EXTS.has(ext)) return LazyImageRenderer;

  // Markdown preview
  if (MARKDOWN_EXTS.has(ext)) return LazyMarkdownPreviewRenderer;

  // Unprintable binary — fallback
  if (UNPRINTABLE_BINARY_EXTS.has(ext)) return LazyBinaryFallback;

  // Default: code/text renderer
  return LazyCodeRenderer;
}
