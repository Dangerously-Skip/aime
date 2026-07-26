// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWidgetRefresh } from './use-widget-refresh';
import { useWidgetStore } from '@/stores/widget-store';
import type { Widget } from '@/lib/widgets/widget';

/** Same ipcRenderer-faithful minute-tick mock as use-cron.test. */
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
const refreshCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/widgets/refresh'));

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ node: { type: 'divider' } }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  useWidgetStore.setState({ widgets: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe('useWidgetRefresh', () => {
  it('refreshes a due widget on the tick and stores the render', async () => {
    const mock = installMinuteTickMock();
    // never run ⇒ due immediately
    useWidgetStore.setState({ widgets: [widget()] });
    renderHook(() => useWidgetRefresh());

    await mock.tick(Date.now());

    expect(refreshCalls()).toHaveLength(1);
    expect(useWidgetStore.getState().getWidget('w1')?.render).toEqual({ type: 'divider' });
  });

  it('skips widgets that are not yet due, disabled, or manual', async () => {
    const mock = installMinuteTickMock();
    const now = Date.now();
    useWidgetStore.setState({
      widgets: [
        widget({ id: 'fresh', refreshedAt: now - 60_000 }), // 1m ago, due in 30m
        widget({ id: 'off', enabled: false }),
        widget({ id: 'manual', refreshEverySeconds: undefined }),
      ],
    });
    renderHook(() => useWidgetRefresh());

    await mock.tick(now);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('refreshes once the interval elapses', async () => {
    const mock = installMinuteTickMock();
    const now = Date.now();
    useWidgetStore.setState({ widgets: [widget({ refreshedAt: now - 31 * 60_000 })] });
    renderHook(() => useWidgetRefresh());

    await mock.tick(now);
    expect(refreshCalls()).toHaveLength(1);
  });

  // The listener-leak discipline from useStandingOrders/useCron applies here too.
  it('registers exactly one tick listener regardless of re-renders', async () => {
    const mock = installMinuteTickMock();
    const { rerender } = renderHook(() => useWidgetRefresh());
    rerender();
    rerender();
    expect(mock.listenerCount()).toBe(1);
  });

  it('stamps refreshedAt on failure so a broken widget retries next interval, not every tick', async () => {
    const mock = installMinuteTickMock();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 502 }));
    useWidgetStore.setState({ widgets: [widget()] });
    renderHook(() => useWidgetRefresh());

    await mock.tick(Date.now());
    expect(refreshCalls()).toHaveLength(1);
    expect(useWidgetStore.getState().getWidget('w1')?.refreshedAt).toBeTruthy();

    // the very next tick must NOT re-fire — the interval hasn't elapsed
    await mock.tick(Date.now() + 60_000);
    expect(refreshCalls()).toHaveLength(1);
  });
});
