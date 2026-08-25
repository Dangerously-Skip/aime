// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCron } from './use-cron';

/**
 * THE RENDERER'S TICKER — now reading the order manifest alone.
 *
 * This suite drove a browser cron store, which no longer exists: jobs live in
 * the order manifest and are fetched, so the hook's shape changed from
 * "synchronous store read" to "async pull into a ref, ticked synchronously".
 *
 * The listener discipline it was really protecting is unchanged and still
 * tested: exactly one registration for the hook's lifetime, unsubscribed on
 * unmount, latest callback used without re-registering. Cron shipped dead once
 * because nothing subscribed at all, and these are what would notice.
 */

/**
 * Mock of the Electron preload minute-tick API with real ipcRenderer semantics:
 * every onMinuteTick() ADDS a listener, the returned unsubscribe removes it,
 * and tick() fires all of them — exactly as ipcRenderer.emit would.
 */
function installMinuteTickMock() {
  const listeners = new Set<(ts: number) => void>();
  window.electronAPI = {
    onMinuteTick: (cb: (ts: number) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  } as unknown as Window['electronAPI'];
  return {
    tick: (ts: number) => act(() => { [...listeners].forEach((l) => l(ts)); }),
    listenerCount: () => listeners.size,
  };
}

let seq = 0;
const order = (over: Record<string, unknown> = {}) => ({
  id: `job${++seq}`,
  instruction: 'do the thing',
  attended: true,
  surfaceId: 'chat',
  trigger: { type: 'cron', expression: '0 9 * * *' },
  status: 'active',
  runCount: 0,
  ...over,
});

/** 09:00 on a Monday — matches `0 9 * * *`. */
const NINE_AM = new Date(2026, 6, 20, 9, 0, 30).getTime();
const TEN_AM = new Date(2026, 6, 20, 10, 0, 30).getTime();

/** Serve these orders, and record any writes. */
function server(orders: unknown[]) {
  const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ orders }) },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => { seq = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('firing', () => {
  it('fires a matching job on the tick', async () => {
    const fetchMock = server([order()]);
    const { tick } = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useCron(onFire));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    tick(NINE_AM);
    expect(onFire).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'do the thing', surfaceId: 'chat' }),
    );
  });

  it('does not fire a job whose expression does not match', async () => {
    server([order()]);
    const { tick } = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useCron(onFire));
    await waitFor(() => expect(true).toBe(true));

    tick(TEN_AM);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('does not fire a paused job', async () => {
    server([order({ status: 'paused' })]);
    const { tick } = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useCron(onFire));
    await waitFor(() => expect(true).toBe(true));

    tick(NINE_AM);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('does not fire an UNATTENDED order — that is the server ticker', async () => {
    // Both firing is a job that runs twice; this is the renderer half of that
    // guard, and it is the whole reason `attended` exists.
    server([order({ attended: false })]);
    const { tick } = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useCron(onFire));
    await waitFor(() => expect(true).toBe(true));

    tick(NINE_AM);
    expect(onFire).not.toHaveBeenCalled();
  });
});

describe('the same-minute guard', () => {
  it('a second tick in the same minute does not fire it again', async () => {
    /*
     * A tick CAN arrive twice inside one minute — a resumed laptop, two
     * listeners, a slow tick — and a cron expression matches for the whole
     * minute. The hook stamps `lastRun` into its in-memory copy immediately,
     * precisely so the second tick sees it without waiting for a round trip.
     */
    server([order()]);
    const { tick } = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useCron(onFire));
    await waitFor(() => expect(true).toBe(true));

    tick(NINE_AM);
    tick(NINE_AM + 2_000);
    expect(onFire, 'the job fired twice in one minute').toHaveBeenCalledTimes(1);
  });

  it('persists the run, so it survives a reload', async () => {
    const fetchMock = server([order()]);
    const { tick } = installMinuteTickMock();
    renderHook(() => useCron(vi.fn()));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    tick(NINE_AM);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'PUT')).toBe(true),
    );
  });
});

describe('listener discipline', () => {
  it('registers exactly one listener, however often it renders', async () => {
    // Cron shipped dead once because nothing subscribed; the opposite failure
    // is a leak that fires each job once per accumulated listener.
    server([order()]);
    const { listenerCount } = installMinuteTickMock();
    const { rerender } = renderHook(() => useCron(vi.fn()));
    await waitFor(() => expect(true).toBe(true));
    rerender();
    rerender();
    expect(listenerCount()).toBe(1);
  });

  it('unsubscribes on unmount', async () => {
    server([order()]);
    const { listenerCount } = installMinuteTickMock();
    const { unmount } = renderHook(() => useCron(vi.fn()));
    await waitFor(() => expect(true).toBe(true));
    unmount();
    expect(listenerCount()).toBe(0);
  });

  it('uses the latest callback without re-registering', async () => {
    server([order()]);
    const { tick, listenerCount } = installMinuteTickMock();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useCron(cb), { initialProps: { cb: first } });
    await waitFor(() => expect(true).toBe(true));

    rerender({ cb: second });
    tick(NINE_AM);
    expect(listenerCount()).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('is a no-op outside Electron', () => {
    server([order()]);
    window.electronAPI = undefined as unknown as Window['electronAPI'];
    expect(() => renderHook(() => useCron(vi.fn()))).not.toThrow();
  });
});
