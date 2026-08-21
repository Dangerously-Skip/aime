// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

describe('a local file path is served, not opened as file://', () => {
  /*
   * Previewing a file you just wrote is this panel's whole job, so refusing
   * `/Users/…/thing.html` made it useless for its main case. `file://` is not
   * the way to say yes — the webview is handed to an agent, so a preview that
   * loads file:// on request is a way to read the disk through a text box, and
   * a null origin breaks embeds, ES modules and fetch on its own terms.
   *
   * `/api/preview` stands up a static server rooted at the file's OWN directory
   * and returns an http://127.0.0.1 origin. These prove the panel uses it.
   */
  const PATH = '/Users/me/dev/demo/interstellar-explorer.html';

  function renderWithWebview() {
    const loadURL = vi.fn();
    const r = render(<PreviewPanel url="" open onClose={noop} />);
    Object.assign(r.container.querySelector('webview')!, { loadURL, getURL: () => '' });
    return { loadURL };
  }

  const type = (value: string) => {
    const bar = screen.getByLabelText('Preview address');
    fireEvent.change(bar, { target: { value } });
    fireEvent.keyDown(bar, { key: 'Enter' });
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'http://127.0.0.1:45231/interstellar-explorer.html' }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the preview server for an http origin', async () => {
    const { loadURL } = renderWithWebview();
    type(PATH);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/preview');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ path: PATH });
    await waitFor(() =>
      expect(loadURL).toHaveBeenCalledWith('http://127.0.0.1:45231/interstellar-explorer.html'),
    );
  });

  it('never hands file:// to the webview', async () => {
    const { loadURL } = renderWithWebview();
    type(`file://${PATH}`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The scheme is stripped and the PATH is what gets served.
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).path).toBe(PATH);
    await waitFor(() => expect(loadURL).toHaveBeenCalled());
    for (const [u] of loadURL.mock.calls) expect(String(u)).not.toMatch(/^file:/);
  });

  it('says so in the bar when the file cannot be previewed', async () => {
    // A panel that silently stays blank is the failure this panel has had four
    // times; an unreachable file must produce words, not another dark box.
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });
    renderWithWebview();
    type('/no/such/file.html');
    // A line of its own, so what the user typed survives for them to fix.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not preview/i));
    expect((screen.getByLabelText('Preview address') as HTMLInputElement).value).toBe('/no/such/file.html');
  });

  it('still treats a bare hostname as https, not as a path', async () => {
    const { loadURL } = renderWithWebview();
    type('example.com');
    await waitFor(() => expect(loadURL).toHaveBeenCalledWith('https://example.com/'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
