// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PreviewPanel } from './preview-panel';

/*
 * THE PANEL WITH NO URL YET — the state a user actually meets it in.
 *
 * This is the third round of the same defect, each time one layer further out,
 * and the reason it kept surviving is that each fix was checked by asserting a
 * NAME appeared in the source rather than that anything rendered:
 *
 *   1. the panel returned null unless `open` — fixed
 *   2. it was an overlay with a fixed 480px width, not a dock panel — fixed
 *   3. the SURFACE rendered it as `previewUrl ? <PreviewPanel/> : null`, so the
 *      address bar — the only way for a user to set a url — lived inside a
 *      component that only mounted once a url was already set. You needed a URL
 *      to reach the box that lets you type a URL.
 *
 * The test guarding (2) asserted `expect(code).not.toMatch(/\{previewUrl && \(/)`
 * and `expect(code).toContain('previewSlot=')`. The code used `previewUrl ? (`,
 * so the negative check missed by one character of syntax and the positive one
 * was satisfied by the very line that carried the bug.
 *
 * So this suite renders the thing and looks for somewhere to type.
 */

const noop = () => {};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

describe('with no url', () => {
  it('renders an address bar the user can type into', () => {
    // The whole complaint: "there is nowhere to type".
    render(<PreviewPanel url="" open onClose={noop} />);
    const bar = screen.getByLabelText('Preview address');
    expect(bar).toBeTruthy();
    expect((bar as HTMLInputElement).readOnly).toBe(false);
    expect((bar as HTMLInputElement).disabled).toBe(false);
  });

  it('renders a webview rather than nothing', () => {
    /*
     * An Electron <webview> with an empty src renders NOTHING, which is
     * indistinguishable from the panel being broken — and empty is now the first
     * state a user sees, because the panel mounts before anything sets a url.
     */
    const { container } = render(<PreviewPanel url="" open onClose={noop} />);
    const wv = container.querySelector('webview');
    expect(wv).toBeTruthy();
    expect(wv!.getAttribute('src')).toBe('about:blank');
  });

  it('accepts a typed url and navigates to it', () => {
    const loadURL = vi.fn();
    const { container } = render(<PreviewPanel url="" open onClose={noop} />);
    // Stand in for the Electron webview API, which jsdom has no notion of.
    Object.assign(container.querySelector('webview')!, { loadURL, getURL: () => '' });

    const bar = screen.getByLabelText('Preview address');
    fireEvent.change(bar, { target: { value: 'example.com' } });
    fireEvent.keyDown(bar, { key: 'Enter' });

    expect(loadURL).toHaveBeenCalledWith('https://example.com/');
  });

  it('refuses a non-http scheme', () => {
    /*
     * This webview is handed to an agent. `file://` would give a page — and so
     * anything that can write to that page — read access to the local disk.
     */
    const loadURL = vi.fn();
    const { container } = render(<PreviewPanel url="" open onClose={noop} />);
    Object.assign(container.querySelector('webview')!, { loadURL, getURL: () => '' });

    const bar = screen.getByLabelText('Preview address');
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>x']) {
      fireEvent.change(bar, { target: { value: bad } });
      fireEvent.keyDown(bar, { key: 'Enter' });
    }
    expect(loadURL).not.toHaveBeenCalled();
  });
});

describe('with a url', () => {
  it('still shows the address bar, holding the current page', () => {
    render(<PreviewPanel url="http://localhost:3000/" open onClose={noop} />);
    expect((screen.getByLabelText('Preview address') as HTMLInputElement).value)
      .toBe('http://localhost:3000/');
  });
});
