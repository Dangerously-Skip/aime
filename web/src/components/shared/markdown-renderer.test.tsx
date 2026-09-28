// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

import { MarkdownRenderer, isExternalHref } from './markdown-renderer';

/**
 * A link in a model reply navigated the main window — the one holding the
 * preload bridge — to the linked site. Main now refuses that navigation; these
 * make sure the link still WORKS, by opening as a new window (which main hands
 * to the OS browser) rather than as a navigation main has to cancel.
 */

function link(markdown: string) {
  const { container } = render(<MarkdownRenderer content={markdown} />);
  const a = container.querySelector('a');
  if (!a) throw new Error('no link rendered');
  return a;
}

describe('MarkdownRenderer links', () => {
  it.each([
    '[docs](https://example.com/docs)',
    '[plain](http://example.com)',
    '<https://example.com/autolink>',
    '[mail](mailto:someone@example.com)',
  ])('%s opens outside the app, with no opener and no referrer', (md) => {
    const a = link(md);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a bare URL (GFM autolink literal) is external too', () => {
    const a = link('see https://example.com/x for details');
    expect(a.getAttribute('href')).toBe('https://example.com/x');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it.each(['[top](#section)', '[rel](./notes.md)', '[root](/settings)'])('%s is left as an in-app link', (md) => {
    const a = link(md);
    expect(a.getAttribute('target')).toBeNull();
    expect(a.getAttribute('rel')).toBeNull();
  });

  it('keeps the link text', () => {
    expect(link('[the docs](https://example.com)').textContent).toBe('the docs');
  });

  it('a javascript: link is neutralised before it reaches the anchor', () => {
    const a = link('[x](javascript:alert(1))');
    expect(a.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
  });
});

describe('isExternalHref', () => {
  it('classifies', () => {
    expect(isExternalHref('HTTPS://X.Y')).toBe(true);
    expect(isExternalHref('//cdn.example/x')).toBe(true);
    expect(isExternalHref('#a')).toBe(false);
    expect(isExternalHref(undefined)).toBe(false);
    expect(isExternalHref('file:///etc/passwd')).toBe(false);
  });
});
