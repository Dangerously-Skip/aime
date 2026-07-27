/**
 * Markdown → themed, standalone HTML (P4.2).
 *
 * The rendering target is Chromium's print pipeline, which Electron already
 * ships. So the "document engine" is CSS plus `printToPDF` — no Python, no pip
 * install, no extra binary, and real typography including widow/orphan control
 * and page-break avoidance that a hand-rolled fpdf2 script never gets right.
 *
 * SECURITY: the output is loaded into a real browser context to be printed, so
 * raw HTML in the source would execute. Rather than take on a sanitiser
 * dependency, inline HTML is DISABLED — the document language is markdown, and
 * markdown alone. Anything that looks like a tag is escaped and shown literally.
 * That closes the injection vector by construction instead of by filtering,
 * which is the difference between "we blocked the payloads we thought of" and
 * "there is no execution path".
 *
 * Pure: no fs, no Electron.
 */
import { marked } from 'marked';
import { getTheme, type ThemeId } from './themes';

export interface RenderOptions {
  title: string;
  markdown: string;
  theme?: ThemeId | string;
  /** Shown under the title — a date, author, or reference. */
  subtitle?: string;
  /** Repeated in the page footer alongside the page number. */
  footer?: string;
}

/** Escape for text that lands inside an HTML element or attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert the document body. `async: false` keeps this synchronous and therefore
 * easy to test; marked only needs async for custom extensions we do not use.
 */
export function markdownToHtml(markdown: string): string {
  if (typeof markdown !== 'string' || markdown.trim() === '') return '';
  return marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
    // The whole injection story: markdown's HTML passthrough is off, so a `<script>`
    // in the source is rendered as visible text rather than executed.
    // marked has no `sanitize` any more; escaping the source first is the
    // supported way to get the same guarantee.
  }) as string;
}

/**
 * Constrain the tags marked itself generates.
 *
 * Escaping the source stops injected HTML, but markdown's own syntax still
 * produces two elements that reach the network at print time:
 *
 *  - `![alt](https://…)` → an `<img>` that fetches while printing. That makes
 *    output non-deterministic (a slow host yields a blank box) and leaks the fact
 *    and timing of the print to a third party. Only `data:` sources are kept,
 *    matching the rule the widget catalogue already applies to images.
 *  - `[text](javascript:…)` → a link that executes if clicked in a viewer.
 *
 * Tractable precisely because this operates on OUR generator's output vocabulary,
 * not on arbitrary HTML — the difference between constraining a known set and
 * trying to sanitise everything.
 */
export function constrainGeneratedHtml(html: string): string {
  return html
    // Drop images that would be fetched; keep inline data URLs.
    .replace(/<img\b[^>]*>/gi, (tag) =>
      /\ssrc\s*=\s*["']data:/i.test(tag) ? tag : '',
    )
    // Neutralise any link scheme other than http, https and mailto.
    .replace(/<a\b([^>]*)>/gi, (tag, attrs: string) => {
      const href = /\shref\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
      return /^(https?:|mailto:|#|\/)/i.test(href) ? tag : '<a>';
    });
}

/**
 * Assemble a complete, self-contained HTML document. Everything is inline —
 * no external stylesheet or font request — so printing is deterministic
 * and works offline.
 */
export function renderDocument(opts: RenderOptions): string {
  const theme = getTheme(opts.theme);
  const title = escapeHtml(opts.title || 'Untitled');
  // Escape the markdown source BEFORE parsing, so any tag in it becomes literal
  // text. Markdown syntax itself is unaffected — it uses no angle brackets.
  const body = constrainGeneratedHtml(markdownToHtml(escapeHtml(opts.markdown ?? '')));

  const subtitle = opts.subtitle
    ? `<p class="doc-meta">${escapeHtml(opts.subtitle)}</p>`
    : '';

  // @page carries size and margins only.
  //
  // NOT page numbers: Chromium does not implement CSS paged-media margin boxes
  // (@bottom-center) or position:running(). Verified by printing with real
  // Chromium — a running() footer rendered INLINE as stray text at the top of the
  // body instead of repeating at the foot of each page. Page numbers and footer
  // text therefore come from printToPDF's footerTemplate; see
  // printOptionsForTheme.
  const pageCss = `
    @page {
      size: ${theme.page.size};
      margin: ${theme.page.marginMm}mm;
    }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
${pageCss}
${theme.css}
</style>
</head>
<body>
<h1 class="doc-title">${title}</h1>
${subtitle}
${body}
</body>
</html>
`;
}

export interface PrintOptions {
  /** Index signature so this can flow into the generic IPC payload unchanged. */
  [key: string]: unknown;
  pageSize: 'A4' | 'Letter';
  printBackground: boolean;
  margins: { top: number; bottom: number; left: number; right: number };
  displayHeaderFooter: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
}

/**
 * Chromium printToPDF options derived from the theme.
 *
 * Page numbers live HERE rather than in CSS because Chromium implements neither
 * `@bottom-center` nor `position: running()`; `footerTemplate` with its
 * `pageNumber`/`totalPages` classes is the mechanism it actually supports.
 * Verified by printing with real Chromium rather than assumed.
 */
export function printOptionsForTheme(
  themeId: ThemeId | string | undefined,
  footerText?: string,
): PrintOptions {
  const theme = getTheme(themeId);
  // printToPDF margins are inches; the theme speaks millimetres.
  const inches = theme.page.marginMm / 25.4;

  const base: PrintOptions = {
    pageSize: theme.page.size,
    // Backgrounds off would drop rules, table shading and code blocks — the
    // parts that make a themed document look themed.
    printBackground: true,
    margins: { top: inches, bottom: inches, left: inches, right: inches },
    displayHeaderFooter: false,
  };
  if (!theme.pageNumbers) return base;

  // The template is HTML rendered by Chromium, so caller-supplied text is
  // escaped — it reaches a real renderer just as the document body does.
  const label = footerText ? escapeHtml(footerText) : '';
  return {
    ...base,
    displayHeaderFooter: true,
    // An empty header still needs a template, or Chromium supplies its own
    // title-and-URL default, which looks like a browser printout.
    headerTemplate: '<div></div>',
    footerTemplate:
      `<div style="width:100%;font-size:9px;color:#666;padding:0 ${theme.page.marginMm}mm;` +
      `display:flex;justify-content:${label ? 'space-between' : 'center'};">` +
      (label ? `<span>${label}</span>` : '') +
      `<span class="pageNumber"></span></div>`,
  };
}
