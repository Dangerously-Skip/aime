// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useWidgetRefresh } from './use-widget-refresh';
import { useWidgetStore } from '@/stores/widget-store';
import type { Widget } from '@/lib/widgets/widget';

/**
 * C5 changed this hook's job: the SERVER now owns scheduled execution, and the
 * renderer only syncs — push the widget list to the manifest, pull back renders
 * produced while the window was closed. These tests pin the ownership rule:
 * the renderer must never fire a scheduled refresh itself.
 */

function installMinuteTickMock() {
  const listeners = new Set<(ts: number) => void>();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    onMinuteTick: (cb: (ts: number) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    tick: async (ts: number) => {
      await act(async () => {
        await Promise.all([...listeners].map((l) => l(ts)));
      });
    },
    listenerCount: () => listeners.size,
  };
}

const widget = (over: Partial<Widget> = {}): Widget => ({
  id: 'w1',
  title: 'Build health',
  recipe: 'Show overnight build failures',
  render: null,
  enabled: true,
  createdAt: 0,
  refreshEverySeconds: 1_800,
  ...over,
});

const fetchMock = vi.fn();
const calls = (method: string) =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes('/api/schedule/widgets') && ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  );
const refreshCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/widgets/refresh'));

function serveManifest(widgets: Widget[]) {
  fetchMock.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'PUT') return new Response('{"ok":true}', { status: 200 });
    return new Response(JSON.stringify({ widgets }), { status: 200 });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  serveManifest([]);
  vi.stubGlobal('fetch', fetchMock);
  useWidgetStore.setState({ widgets: [] });
});
afterEach(() => {
  // Unmount hook instances — their store subscriptions would otherwise keep
  // pushing from previous tests and corrupt the call counts.
  cleanup();
  vi.unstubAllGlobals();
});

describe('useWidgetRefresh (sync)', () => {
  it('pushes the widget list to the server manifest', async () => {
    useWidgetStore.setState({ widgets: [widget()] });
    installMinuteTickMock();
    renderHook(() => useWidgetRefresh());

    await waitFor(() => expect(calls('PUT').length).toBeGreaterThan(0));
    const body = JSON.parse((calls('PUT')[0][1] as RequestInit).body as string);
    expect(body.widgets[0]).toMatchObject({ id: 'w1', recipe: 'Show overnight build failures' });
  });

  // The whole point of C5: work done while the window was closed appears.
  it('pulls back a render the scheduler produced while the window was closed', async () => {
    useWidgetStore.setState({ widgets: [widget({ refreshedAt: 1_000 })] });
    serveManifest([
      widget({ refreshedAt: 9_000, render: { type: 'metric', label: 'Failures', value: '0' } }),
    ]);
    installMinuteTickMock();
    renderHook(() => useWidgetRefresh());

    await waitFor(() =>
      expect(useWidgetStore.getState().getWidget('w1')?.render).toMatchObject({ value: '0' }),
    );
    expect(useWidgetStore.getState().getWidget('w1')?.refreshedAt).toBe(9_000);
  });

  it('does not clobber a NEWER local render with an older server one', async () => {
    useWidgetStore.setState({
      widgets: [widget({ refreshedAt: 9_000, render: { type: 'divider' } })],
    });
    serveManifest([widget({ refreshedAt: 1_000, render: { type: 'metric', label: 'x', value: '1' } })]);
    installMinuteTickMock();
    renderHook(() => useWidgetRefresh());

    // Give the pull a beat, then confirm nothing changed.
    await waitFor(() => expect(calls('GET').length).toBeGreaterThan(0));
    expect(useWidgetStore.getState().getWidget('w1')?.render).toEqual({ type: 'divider' });
  });

  // Ownership: the server fires schedules. The renderer must not.
  it('never fires a scheduled refresh from the renderer, even for a due widget', async () => {
    const mock = installMinuteTickMock();
    useWidgetStore.setState({ widgets: [widget()] }); // never run ⇒ "due"
    renderHook(() => useWidgetRefresh());

    await mock.tick(Date.now());
    await mock.tick(Date.now() + 60_000);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('pulls again on the minute tick while the window is open', async () => {
    const mock = installMinuteTickMock();
    renderHook(() => useWidgetRefresh());
    await waitFor(() => expect(calls('GET').length).toBe(1));

    await mock.tick(Date.now());
    await waitFor(() => expect(calls('GET').length).toBe(2));
  });

  it('registers exactly one tick listener regardless of re-renders', async () => {
    const mock = installMinuteTickMock();
    const { rerender } = renderHook(() => useWidgetRefresh());
    rerender();
    rerender();
    expect(mock.listenerCount()).toBe(1);
  });

  it('skips the push when nothing material changed', async () => {
    useWidgetStore.setState({ widgets: [widget()] });
    installMinuteTickMock();
    renderHook(() => useWidgetRefresh());
    await waitFor(() => expect(calls('PUT').length).toBe(1));

    // A store write that changes nothing material (same snapshot) → no new PUT.
    act(() => useWidgetStore.setState((s) => ({ widgets: [...s.widgets] })));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('PUT').length).toBe(1);
  });
});
