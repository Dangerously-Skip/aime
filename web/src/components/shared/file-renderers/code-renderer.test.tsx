// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import hljs from 'highlight.js/lib/common';
import { CodeRenderer } from './code-renderer';
import { escapeHtml } from '@/lib/documents/render';

/**
 * This component writes to `dangerouslySetInnerHTML`, and its input is FILE
 * CONTENT — anything on disk, including a file the agent just wrote. So the
 * escaping is a security boundary, and it had no test at all: the escaper was a
 * private copy of the one in documents/render, differing only in the apostrophe
 * entity, and nothing exercised the branch that used it.
 *
 * Two sinks are covered, because the component has two paths into that innerHTML:
 *   1. highlight.js output, for a language the bundle registers;
 *   2. `escapeHtml(content)`, when hljs throws.
 *
 * Path 2 is reachable in production, not hypothetical: EXT_TO_LANG maps
 * '.dockerfile' to "dockerfile", which `highlight.js/lib/common` does not
 * register, so `hljs.highlight` throws Unknown language and the escaper is the
 * only thing between the file and the DOM.
 */

const XSS = `<script>window.__pwned = true</script><img src=x onerror="window.__pwned = true">`;

function output(): HTMLElement {
  return screen.getByTestId('code-renderer-output');
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__pwned;
});

describe('CodeRenderer — the escape fallback is a live path, not a dead branch', () => {
  it('.dockerfile really does throw in the common bundle', () => {
    // Pins the premise of the test below. If hljs ever ships dockerfile in
    // `common`, the fallback stops being exercised and this says so.
    expect(hljs.listLanguages()).not.toContain('dockerfile');
    expect(() => hljs.highlight('FROM x', { language: 'dockerfile', ignoreIllegals: true })).toThrow();
  });

  it('escapes markup instead of injecting it when highlighting throws', () => {
    render(<CodeRenderer content={XSS} ext=".dockerfile" />);

    const el = output();
    // No live nodes: the markup is text, not DOM.
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).toContain('&lt;script&gt;');
    expect(el.innerHTML).not.toContain('<script>');
    // …and the user still sees the file exactly as written.
    expect(el.textContent).toBe(XSS);
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('produces exactly what the shared escaper produces', () => {
    const content = `a & b < c > d " e ' f <b>g</b>`;
    render(<CodeRenderer content={content} ext=".dockerfile" />);

    // Compared through a reference node rather than against the escaper's string
    // directly: innerHTML is a RE-SERIALISATION of the parsed DOM, and a browser
    // does not re-escape " or ' in a text node (they are only special inside an
    // attribute). So `escapeHtml`'s &quot; and &#39; come back as raw characters,
    // and asserting on the raw string would be asserting on the parser, not on us.
    const reference = document.createElement('code');
    reference.innerHTML = escapeHtml(content);
    expect(output().innerHTML).toBe(reference.innerHTML);

    // The characters that actually matter are escaped, and nothing became markup.
    expect(output().innerHTML).toContain('&lt;b&gt;');
    expect(output().children.length).toBe(0);
    expect(output().textContent).toBe(content);
  });

  it('does not double-escape an ampersand that already looks like an entity', () => {
    // &amp; must survive as the literal five characters the file contains.
    render(<CodeRenderer content={'x &amp; y'} ext=".dockerfile" />);
    expect(output().textContent).toBe('x &amp; y');
  });
});

describe('CodeRenderer — the highlight.js path', () => {
  it('escapes markup in a language it does highlight', () => {
    render(<CodeRenderer content={XSS} ext=".ts" />);

    const el = output();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    // hljs adds its own span markup, so compare on text rather than innerHTML.
    expect(el.textContent).toBe(XSS);
  });

  it('escapes markup on the auto-detect path (unknown extension)', () => {
    render(<CodeRenderer content={XSS} ext=".unheard-of" />);

    const el = output();
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(el.textContent).toBe(XSS);
  });

  it('still highlights, so the escaping did not cost the feature', () => {
    render(<CodeRenderer content={'const x = 1;'} ext=".ts" />);
    const el = output();
    expect(el.className).toContain('language-typescript');
    expect(el.querySelectorAll('span.hljs-keyword').length).toBeGreaterThan(0);
    expect(el.textContent).toBe('const x = 1;');
  });
});
