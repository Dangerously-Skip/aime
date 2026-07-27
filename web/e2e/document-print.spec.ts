import { test, expect, chromium } from '@playwright/test';
import { renderDocument, printOptionsForTheme } from '../src/lib/documents/render';

/**
 * Prints real PDFs with real Chromium and reads the text back out.
 *
 * This exists because unit tests cannot tell you whether CSS actually works in a
 * print pipeline, and assuming it does was already wrong once: the first version
 * used `position: running()` and `@bottom-center` for the footer, neither of which
 * Chromium implements. The footer rendered inline as stray text at the top of the
 * document, and no unit test could have caught it.
 *
 * `page.pdf()` drives the same Chrome DevTools Protocol `Page.printToPDF` that
 * Electron's `webContents.printToPDF` uses, so this verifies the real mechanism
 * without needing to launch the desktop app.
 */

/** Extract per-page text using pdfjs-dist, which the app already depends on. */
async function pdfPages(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return pages;
}

/**
 * Strip whitespace before matching. pdfjs splits ligatures when extracting — the
 * footer "ACME Confidential" comes back as "ACME Con fi dential" — so an exact
 * substring match fails on text that rendered perfectly well.
 */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

async function printToPdf(html: string, options: Record<string, unknown>): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const opts = options as { pageSize?: string; margins?: { top: number } };
    return await page.pdf({
      format: (opts.pageSize as 'A4') ?? 'A4',
      printBackground: options.printBackground as boolean,
      displayHeaderFooter: options.displayHeaderFooter as boolean,
      headerTemplate: options.headerTemplate as string | undefined,
      footerTemplate: options.footerTemplate as string | undefined,
      margin: opts.margins
        ? {
            top: `${opts.margins.top}in`,
            bottom: `${opts.margins.top}in`,
            left: `${opts.margins.top}in`,
            right: `${opts.margins.top}in`,
          }
        : undefined,
    });
  } finally {
    await browser.close();
  }
}

const longBody = `## Overview\n\n${'A paragraph of body copy that fills the page. '.repeat(40)}\n\n## Detail\n\n${'More body copy to force a second page. '.repeat(60)}\n`;

test('renders the content and the title into a real PDF', async () => {
  const html = renderDocument({
    title: 'Quarterly Report',
    subtitle: '27 July 2026',
    markdown: '## Summary\n\nRevenue grew by twelve percent.\n',
    theme: 'report',
  });
  const pdf = await printToPdf(html, printOptionsForTheme('report', 'Quarterly Report'));
  const pages = await pdfPages(pdf);

  expect(pages.length).toBeGreaterThanOrEqual(1);
  expect(pages[0]).toContain('Quarterly Report');
  expect(pages[0]).toContain('27 July 2026');
  expect(pages[0]).toContain('Revenue grew by twelve percent.');
});

test('page numbers appear on every page of a multi-page document', async () => {
  // The regression this file was written for. CSS @bottom-center produced none.
  const html = renderDocument({ title: 'Long Report', markdown: longBody, theme: 'report' });
  const pdf = await printToPdf(html, printOptionsForTheme('report', 'Long Report'));
  const pages = await pdfPages(pdf);

  expect(pages.length).toBeGreaterThan(1);
  pages.forEach((text, i) => {
    expect(text, `page ${i + 1} has no page number`).toMatch(new RegExp(`\\b${i + 1}\\b`));
  });
});

test('the footer label repeats on later pages rather than appearing inline once', async () => {
  const html = renderDocument({ title: 'Long Report', markdown: longBody, theme: 'report' });
  const pdf = await printToPdf(html, printOptionsForTheme('report', 'ACME Confidential'));
  const pages = await pdfPages(pdf);

  expect(pages.length).toBeGreaterThan(1);
  for (const [i, text] of pages.entries()) {
    expect(squash(text), `page ${i + 1} missing the footer label`).toContain('ACMEConfidential');
  }
});

test('a theme with page numbers off produces none, and no browser default furniture', async () => {
  // Chromium injects its own title-and-URL header unless a template is supplied.
  const html = renderDocument({ title: 'Quick Memo', markdown: longBody, theme: 'memo' });
  const options = printOptionsForTheme('memo');
  expect(options.displayHeaderFooter).toBe(false);

  const pages = await pdfPages(await printToPdf(html, options));
  for (const text of pages) {
    expect(text).not.toContain('http://');
    expect(text).not.toContain('about:blank');
  }
});

test('injected markup is inert in the printed output', async () => {
  const html = renderDocument({
    title: 'Safe',
    markdown: '<script>document.title="pwned"</script>\n\nBody text.\n',
  });
  const pages = await pdfPages(await printToPdf(html, printOptionsForTheme('report')));

  // The evidence of inertness is that the DELIMITERS are visible: a browser that
  // parsed this as markup would never print "<script>" as text. The payload's
  // inner text appearing is expected and correct — it is being displayed, not run.
  expect(pages[0]).toContain('Body text.');
  expect(pages[0]).toContain('<script>');
  expect(pages[0]).toContain('</script>');
});

test('a remote image is not fetched during printing', async () => {
  const requested: string[] = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('request', (r) => requested.push(r.url()));
    await page.setContent(
      renderDocument({ title: 'T', markdown: '![x](https://example.invalid/tracker.png)' }),
      { waitUntil: 'load' },
    );
    await page.pdf({ format: 'A4' });
  } finally {
    await browser.close();
  }

  // A print must not tell a third party that it happened, or when.
  expect(requested.filter((u) => u.includes('example.invalid'))).toEqual([]);
});
