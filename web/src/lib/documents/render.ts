/**
 * Markdown → themed, standalone HTML (P4.2).
 *
 * The rendering target is Chromium's print pipeline, which Electron already
 * ships. So the "document engine" is CSS plus `printToPDF` — no Python, no pip
 * install, no extra binary, and real typography including widow/orphan control
 * and page-break avoidance that a hand-rolled fpdf2 script never gets right.
 *
 * SECURITY: the output is loaded into a real browser context to be printed, so
 * raw HTML in the source would execute. Inline HTML is therefore DISABLED — the
 * document language is markdown alone, and anything tag-shaped is shown as
 * literal text. That closes the vector by construction rather than by filtering.
 *
 * HOW matters, though. The first version escaped the whole markdown SOURCE before
 * parsing, which double-escaped everything marked escapes itself: a code block
 * containing `a < b && c > d` printed as `a &lt; b &amp;&amp; c &gt; d`, making
 * every technical document unreadable, and `>` being pre-escaped meant blockquote
 * syntax could never be recognised at all — leaving the blockquote rule in all
 * four themes as dead CSS. Neither was visible to a unit test that only used
 * code without special characters.
 *
 * So the escaping is applied to raw-HTML TOKENS only, via a renderer override.
 * marked's own (correct, single) escaping then handles code, and normal markdown
 * constructs work.
 *
 * That was still not enough. A raw-HTML override only sees raw-HTML tokens, and
 * markdown has another route into markup: the ATTRIBUTES marked builds itself.
 * Its `image` renderer takes alt text from its TextRenderer — which returns text
 * raw, by design — and interpolates it into `alt="…"` unescaped, so
 * `![a" onerror="…](data:image/png;…)` executed, as did an alt that closed the
 * tag and opened a `<script>`. Escaping at the source could never have caught it
 * either, since the alt is re-derived during rendering.
 *
 * The fix is therefore per-SINK: `image` and `link` are overridden too, and build
 * their attributes from escaped, validated parts. Escaping happens by
 * construction, not by inspecting the generated string afterwards.
 *
 * Pure: no fs, no Electron.
 */
import { Marked } from 'marked';
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
 * Escape a value we are about to interpolate into a double-quoted attribute.
 *
 * Differs from escapeHtml in one way: an `&` that already begins a valid entity
 * is left alone. That is the rule marked applies to body text, so alt text and
 * body text escape identically, and it avoids re-running FIX-3's mistake in
 * miniature — `![Tom &amp; Jerry]` must not become `alt="Tom &amp;amp; Jerry"`.
 *
 * Preserving entities is safe: a character reference inside an attribute value is
 * decoded AFTER the tokeniser has found the closing quote, so `&quot;` is data
 * and cannot terminate the attribute. It is a literal `"` that ends it, which is
 * why that is the character the break-out needed.
 */
const ENTITY_SAFE_AMP = /&(?!#\d{1,7};|#[Xx][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g;
function escapeAttribute(value: string): string {
  return value
    .replace(ENTITY_SAFE_AMP, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Percent-encode a URL, or return null if it cannot be encoded.
 *
 * The point is not tidiness: after this, the value provably contains no `"`, `<`
 * or `>`, so it cannot break out of the attribute regardless of what the scheme
 * check below decides. Same approach marked takes internally; done here so the
 * guarantee does not depend on marked continuing to.
 */
function encodeUrl(href: string): string | null {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null; // a lone surrogate or malformed escape
  }
}

/** Schemes a link may keep. A positive allowlist, so novel schemes are dropped. */
const SAFE_LINK_HREF = /^(https?:|mailto:|#|\/)/i;
/**
 * Images must be self-contained. Only inline image data — never a URL that would
 * be fetched while printing, which makes output non-deterministic and leaks the
 * fact and timing of the print. Same rule the widget catalogue applies to images.
 * (`data:image/svg+xml` is included: SVG loaded through `<img>` cannot script.)
 */
const SAFE_IMAGE_SRC = /^data:image\//i;

/**
 * A marked instance whose only deviations from stock are that raw HTML renders as
 * visible text, and that the two renderers which build attributes do so from
 * escaped, validated parts.
 *
 * Built once at module scope: `marked.use` mutates the instance it is called on,
 * so calling it per render would stack the extension repeatedly.
 */
const documentMarked = new Marked({ async: false, gfm: true, breaks: false });
documentMarked.use({
  renderer: {
    // Covers both block-level and inline raw HTML — marked routes both here.
    html({ raw }: { raw: string }) {
      return escapeHtml(raw);
    },

    /**
     * Overridden because marked's own `image` is an XSS sink: it renders alt text
     * through its TextRenderer, which returns text RAW by design, and interpolates
     * the result straight into `alt="…"`. So `![a" onerror="x](data:image/png;…)`
     * produced a live event handler, and `![a"><script>…<b x="](…)` produced a
     * real script element — both verified executing in Chromium at file://. The
     * `html` override could not see either, because alt text never becomes an
     * html TOKEN.
     *
     * Fixing it here rather than in the output string is the difference between a
     * guarantee and a filter: href and alt arrive as separate values, so escaping
     * is by construction.
     */
    image({ href, title, text, tokens }) {
      const alt = escapeAttribute(
        tokens?.length ? this.parser.parseInline(tokens, this.parser.textRenderer) : text,
      );
      const src = encodeUrl(href);
      // No usable image: show the alt text, which is what marked does for a URL
      // it cannot clean, and keeps the caption visible to the reader.
      if (src === null || !SAFE_IMAGE_SRC.test(src)) return alt;
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
      return `<img src="${escapeAttribute(src)}" alt="${alt}"${titleAttr}>`;
    },

    /**
     * Overridden for the same reason — so the scheme rule is applied to the href
     * as DATA, before it is ever part of a tag, instead of being scraped back out
     * of the generated string afterwards.
     *
     * Link TEXT goes through the full renderer (not the TextRenderer), so raw HTML
     * inside it is already handled by the `html` override above; an image inside
     * link text lands in `image`, above.
     */
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = encodeUrl(href);
      // Keep the anchor so the text still reads as it was written, drop the href.
      if (url === null || !SAFE_LINK_HREF.test(url)) return `<a>${text}</a>`;
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
      return `<a href="${escapeAttribute(url)}"${titleAttr}>${text}</a>`;
    },
  },
});

/**
 * Convert the document body. Synchronous, so it stays easy to test; marked only
 * needs async for extensions we do not use.
 */
export function markdownToHtml(markdown: string): string {
  if (typeof markdown !== 'string' || markdown.trim() === '') return '';
  return documentMarked.parse(markdown) as string;
}

/**
 * DEFENCE IN DEPTH ONLY — layer 3.
 *
 * The `image` and `link` renderer overrides above are the guarantee: they never
 * emit a remote `<img src>` or a non-web `href` in the first place. This pass
 * repeats both rules on the finished string, so a future renderer change (a new
 * marked version, a new extension, an extra override) that reintroduces one is
 * still caught.
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
 *
 * CAVEAT, and the reason this cannot be the primary defence: it regex-scrapes
 * attributes back out of marked's output, so it depends on how marked happens to
 * serialise a tag — attribute order, quote character, whether `src` comes first.
 * That is an implementation detail a marked upgrade may change, and the failure
 * mode is silent. It also cannot see anything smuggled through a value that is
 * escaped at the source (the alt-text break-out this layer never noticed).
 * Correctness has to live in the renderer, where the parts are still data.
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
  // Raw HTML is neutralised by the renderer (see markdownToHtml), not by escaping
  // the source — pre-escaping broke code blocks and blockquotes.
  const body = constrainGeneratedHtml(markdownToHtml(opts.markdown ?? ''));

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
