// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HighlightedEditor } from './highlighted-editor';
import { resolveHljsLanguage } from '@/components/shared/file-renderers/hljs-language';

/**
 * EDITING KEEPS THE COLOURS.
 *
 * Clicking the pencil swapped the highlighted viewer for a bare `<textarea>`,
 * which can only ever be one colour — so the moment you started changing code
 * you lost the thing that makes code readable. Silently, because a plain
 * textarea looks deliberate rather than broken.
 *
 * The overlay is a PICTURE of the text and the textarea is the text. Both
 * halves are asserted here: the colour has to appear, and the editing has to
 * still be a real textarea rather than a contenteditable reimplementation.
 */

afterEach(cleanup);

describe('the highlighted editor', () => {
  it('renders highlight spans over the content', () => {
    const { container } = render(
      <HighlightedEditor value="const a = 1;" onChange={() => {}} ext=".js" />,
    );
    // hljs emits class-bearing spans; a plain textarea emits none.
    expect(container.querySelectorAll('.hljs span').length).toBeGreaterThan(0);
    expect(container.querySelector('code')?.textContent).toContain('const a = 1;');
  });

  it('is still a real textarea, and reports edits', () => {
    const onChange = vi.fn();
    render(<HighlightedEditor value="a" onChange={onChange} ext=".js" />);

    const ta = screen.getByTestId('code-editor-input') as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA'); // native undo, selection, a11y
    fireEvent.change(ta, { target: { value: 'ab' } });
    expect(onChange).toHaveBeenCalledWith('ab');
  });

  it('hides the overlay from assistive tech', () => {
    // Both layers carry the same text; a screen reader meeting both reads the
    // file twice.
    const { container } = render(<HighlightedEditor value="x" onChange={() => {}} />);
    expect(container.querySelector('pre')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('pre')?.className).toContain('pointer-events-none');
  });

  it('keeps a trailing newline visible to the overlay', () => {
    /*
     * `<pre>` collapses a final newline, so with the caret on a new last line
     * the textarea has scrolled a row further than the overlay and the two
     * drift apart exactly while you are typing.
     */
    const { container } = render(<HighlightedEditor value={'a\n'} onChange={() => {}} ext=".js" />);
    expect(container.querySelector('code')?.textContent?.endsWith('\n')).toBe(false);
    expect(container.querySelector('code')?.textContent).toMatch(/a\n /);
  });

  it('falls back to plain text for an unknown language rather than throwing', () => {
    const { container } = render(
      <HighlightedEditor value="<<< not a language >>>" onChange={() => {}} ext=".zzz" />,
    );
    expect(container.querySelector('code')?.textContent).toContain('not a language');
  });

  it('both layers share one metric class, so they cannot drift', () => {
    // The overlay and the input must agree on font, size, line-height, padding
    // and wrapping. Two copies of those values is how they come apart.
    const { container } = render(<HighlightedEditor value="a" onChange={() => {}} />);
    expect(container.querySelector('pre')?.className).toContain('hl-editor-layer');
    expect(screen.getByTestId('code-editor-input').className).toContain('hl-editor-layer');
  });
});

describe('the language resolver is shared with the viewer', () => {
  it('agrees on a basename that beats its extension', () => {
    // `.env.example`'s extension is ".example". Two copies of this table would
    // colour a file when read and leave it plain when edited.
    expect(resolveHljsLanguage({ ext: '.example', name: '.env.example' }).lang).toBeTruthy();
  });

  it('marks genuinely plain files as plain', () => {
    expect(resolveHljsLanguage({ ext: '.pem', name: 'cert.pem' }).isPlain).toBe(true);
  });
});
