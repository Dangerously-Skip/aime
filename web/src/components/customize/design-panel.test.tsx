// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { DesignPanel, previewDocument } from './design-panel';
import { APP_NAME } from '@/config/branding';

/**
 * Design previews are created lazily and cannot run script.
 *
 * REGRESSION: opening Design created all 36 `sandbox=""` iframes at once, and
 * a per-frame script touching localStorage threw in each (opaque origin) —
 * 36 console errors per open. Frames now appear only as their card nears the
 * viewport, and the document's CSP forbids script.
 *
 * IntersectionObserver and ResizeObserver are stubbed (jsdom has neither);
 * fetch is stubbed. The component's own logic runs.
 */

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

const THEMES = ['nord', 'dracula', 'aurora'].map((id) => ({
  id,
  label: id,
  group: 'Developer palettes',
  tokens: {},
}));

type IOCallback = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;
let observers: Array<{ cb: IOCallback; el: Element | null }> = [];
const fetchMock = vi.fn();

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private rec: { cb: IOCallback; el: Element | null };
      constructor(cb: IOCallback) {
        this.rec = { cb, el: null };
        observers.push(this.rec);
      }
      observe(el: Element) { this.rec.el = el; }
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: (e: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.cb([{ contentRect: { width: 320 } }]); }
      disconnect() {}
    },
  );
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/api/themes')) return json({ themes: THEMES });
    if (u.includes('/api/themes/asset')) return new Response(':root{--bg:#000}', { status: 200 });
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const assetFetches = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/themes/asset'));

describe('DesignPanel previews', () => {
  it('creates no frames and fetches no theme CSS until a card is near the viewport', async () => {
    const { container } = render(<DesignPanel />);
    await screen.findByText('nord');

    expect(container.querySelectorAll('iframe')).toHaveLength(0);
    expect(assetFetches()).toHaveLength(0);
    expect(observers.length).toBe(THEMES.length);
  });

  it('creates exactly the frames that have been scrolled to', async () => {
    const { container } = render(<DesignPanel />);
    await screen.findByText('nord');

    const first = observers[0];
    await act(async () => {
      first.cb([{ isIntersecting: true, target: first.el! }]);
    });

    await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(1));
    const frame = container.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('--bg:#000');
  });
});

describe('previewDocument', () => {
  const doc = previewDocument('.x{color:red}');

  it('forbids script with a CSP, and contains none', () => {
    const csp = doc.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src/);
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/localStorage|sessionStorage/);
  });

  it('still allows the styles and webfonts the preview exists to show', () => {
    expect(doc).toContain(".x{color:red}");
    expect(doc).toMatch(/style-src 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
    expect(doc).toMatch(/font-src https:\/\/fonts\.gstatic\.com/);
    expect(doc).toContain(APP_NAME);
  });
});
