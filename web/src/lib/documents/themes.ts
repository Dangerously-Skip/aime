/**
 * Document themes (P4.2).
 *
 * The old PDF skill handed the model raw fpdf2 code with fonts and colours
 * inline and told it to improvise. Every document therefore looked different, and
 * "make it match the last one" was impossible. The PPT plugin got this right —
 * an authoring format plus a converter — and this generalises that: the model
 * writes CONTENT, the theme decides how it looks.
 *
 * Themes are CSS because the renderer is Chromium (see render.ts). That is not a
 * shortcut: CSS is a real design system with inheritance, and Electron already
 * ships the engine, so there is no Python, no pip install, and no extra binary.
 *
 * Pure data — no DOM, no fs.
 */

export type ThemeId = 'report' | 'memo' | 'proposal' | 'plain';

export interface DocumentTheme {
  id: ThemeId;
  name: string;
  /** One line, shown to the model so it can pick sensibly. */
  description: string;
  /** Page size and margins for Chromium's print pipeline. */
  page: { size: 'A4' | 'Letter'; marginMm: number };
  /** Injected as the stylesheet. Uses only web-safe and system fonts. */
  css: string;
  /** Whether to render a footer with page numbers. */
  pageNumbers: boolean;
}

/**
 * A neutral base every theme builds on, so a theme only expresses what makes it
 * distinct rather than restating typography from scratch.
 */
const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--ink);
    background: #fff;
    font-family: var(--body-font);
    font-size: var(--body-size);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, h4 { font-family: var(--heading-font); color: var(--heading-ink); line-height: 1.25; }
  h1 { font-size: var(--h1-size); margin: 0 0 0.4em; }
  h2 { font-size: var(--h2-size); margin: 1.6em 0 0.5em; }
  h3 { font-size: var(--h3-size); margin: 1.3em 0 0.4em; }
  p { margin: 0 0 0.9em; }
  ul, ol { margin: 0 0 0.9em; padding-left: 1.4em; }
  li { margin: 0 0 0.3em; }
  a { color: var(--accent); text-decoration: none; }
  code {
    font-family: var(--mono-font);
    font-size: 0.9em;
    background: var(--rule-soft);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  pre {
    background: var(--rule-soft);
    padding: 0.8em 1em;
    border-radius: 5px;
    overflow-x: auto;
    /* Never split a code block across pages — a broken listing is unreadable. */
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    margin: 0 0 0.9em;
    padding-left: 1em;
    border-left: 3px solid var(--accent);
    color: var(--muted);
  }
  table { width: 100%; border-collapse: collapse; margin: 0 0 1.1em; font-size: 0.94em; }
  th, td { text-align: left; padding: 0.5em 0.6em; border-bottom: 1px solid var(--rule); }
  th { font-weight: 600; color: var(--heading-ink); border-bottom-width: 2px; }
  tr { page-break-inside: avoid; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 1.6em 0; }
  img { max-width: 100%; }
  /* Keep a heading with the text it introduces. */
  h1, h2, h3, h4 { page-break-after: avoid; }
  .doc-title { margin-bottom: 0.2em; }
  .doc-meta { color: var(--muted); font-size: 0.92em; margin: 0 0 2.2em; }
`;

function theme(
  id: ThemeId,
  name: string,
  description: string,
  vars: string,
  opts: { size?: 'A4' | 'Letter'; marginMm?: number; pageNumbers?: boolean; extra?: string } = {},
): DocumentTheme {
  return {
    id,
    name,
    description,
    page: { size: opts.size ?? 'A4', marginMm: opts.marginMm ?? 20 },
    pageNumbers: opts.pageNumbers ?? true,
    css: `:root {\n${vars}\n}\n${BASE_CSS}${opts.extra ?? ''}`,
  };
}

export const DOCUMENT_THEMES: Record<ThemeId, DocumentTheme> = {
  report: theme(
    'report',
    'Report',
    'Serif body with a ruled title block. For anything long-form or formal.',
    `
    --body-font: Georgia, 'Times New Roman', serif;
    --heading-font: Georgia, 'Times New Roman', serif;
    --mono-font: 'SFMono-Regular', Consolas, monospace;
    --body-size: 11.5pt;
    --h1-size: 25pt; --h2-size: 16pt; --h3-size: 13pt;
    --ink: #1b1b1b; --heading-ink: #111; --muted: #666;
    --accent: #1f4e79; --rule: #d8d8d8; --rule-soft: #f4f4f4;`,
    {
      extra: `
      .doc-title { border-bottom: 2px solid var(--accent); padding-bottom: 0.35em; }
      h2 { border-bottom: 1px solid var(--rule); padding-bottom: 0.2em; }`,
    },
  ),

  memo: theme(
    'memo',
    'Memo',
    'Tight sans-serif, no page furniture. For short internal notes.',
    `
    --body-font: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    --heading-font: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    --mono-font: 'SFMono-Regular', Consolas, monospace;
    --body-size: 10.5pt;
    --h1-size: 19pt; --h2-size: 13.5pt; --h3-size: 11.5pt;
    --ink: #222; --heading-ink: #000; --muted: #767676;
    --accent: #444; --rule: #e2e2e2; --rule-soft: #f6f6f6;`,
    { marginMm: 18, pageNumbers: false },
  ),

  proposal: theme(
    'proposal',
    'Proposal',
    'Generous spacing and a colour accent. For anything going to a client.',
    `
    --body-font: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    --heading-font: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --mono-font: 'SFMono-Regular', Consolas, monospace;
    --body-size: 11pt;
    --h1-size: 30pt; --h2-size: 17pt; --h3-size: 13pt;
    --ink: #262626; --heading-ink: #0f2b46; --muted: #6b7280;
    --accent: #0b6bcb; --rule: #e5e7eb; --rule-soft: #f3f6fa;`,
    {
      marginMm: 24,
      extra: `
      body { line-height: 1.65; }
      h1 { color: var(--accent); }
      h2 { margin-top: 1.9em; }`,
    },
  ),

  plain: theme(
    'plain',
    'Plain',
    'Minimal styling. For drafts, or when the content should not look designed.',
    `
    --body-font: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    --heading-font: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    --mono-font: 'SFMono-Regular', Consolas, monospace;
    --body-size: 11pt;
    --h1-size: 20pt; --h2-size: 14pt; --h3-size: 12pt;
    --ink: #000; --heading-ink: #000; --muted: #555;
    --accent: #000; --rule: #ccc; --rule-soft: #f5f5f5;`,
    { pageNumbers: false },
  ),
};

export const DEFAULT_THEME: ThemeId = 'report';

/**
 * Resolve a theme id, falling back to the default for anything unrecognised.
 *
 * OWN properties only. The guard was `id in DOCUMENT_THEMES`, and `in` walks the
 * prototype chain — so 'constructor', '__proto__', 'toString', 'valueOf',
 * 'hasOwnProperty' and 'isPrototypeOf' all passed it and returned something that
 * is not a theme, and every caller then read `.page.size` off undefined. The
 * DocumentCreate tool declares `theme` as a free-form `z.string()`, so the id
 * really is arbitrary model output and the fallback has to be total.
 */
export function getTheme(id: unknown): DocumentTheme {
  return typeof id === 'string' && Object.hasOwn(DOCUMENT_THEMES, id)
    ? DOCUMENT_THEMES[id as ThemeId]
    : DOCUMENT_THEMES[DEFAULT_THEME];
}

export function themeIds(): ThemeId[] {
  return Object.keys(DOCUMENT_THEMES) as ThemeId[];
}

/** Listing for the tool description, so the model picks rather than guesses. */
export function describeThemes(): string {
  return themeIds()
    .map((id) => `"${id}" — ${DOCUMENT_THEMES[id].description}`)
    .join(' ');
}
