// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCron } from './use-cron';
import { useCronStore, type CronJob } from '@/stores/cron-store';

/**
 * Mock of the Electron preload minute-tick API with real ipcRenderer
 * semantics: every onMinuteTick() call ADDS a listener; the returned
 * unsubscribe removes it. tick() fires all registered listeners, exactly
 * like ipcRenderer.emit would.
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
const job = (overrides: Partial<CronJob> = {}): CronJob => ({
  id: `job${++seq}`,
  expression: '0 9 * * *',
  prompt: 'do the thing',
  surfaceId: 'chat',
  lastRun: null,
  enabled: true,
  createdAt: Date.now(),
  ...overrides,
});

// 2026-07-20 09:00 local
const NINE_AM = new Date(2026, 6, 20, 9, 0, 0).getTime();

beforeEach(() => {
  useCronStore.setState({ jobs: [] });
});

describe('useCron', () => {
  it('fires matching enabled jobs on the minute tick and marks them ran', () => {
    const mock = installMinuteTickMock();
    const match = job();
    const disabled = job({ enabled: false });
    const noMatch = job({ expression: '30 14 * * *' });
    useCronStore.setState({ jobs: [match, disabled, noMatch] });

    const onFire = vi.fn();
    renderHook(() => useCron(onFire));
    mock.tick(NINE_AM);

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith({
      id: match.id,
      prompt: match.prompt,
      surfaceId: match.surfaceId,
    });
    expect(useCronStore.getState().jobs.find((j) => j.id === match.id)?.lastRun).not.toBeNull();
  });

  it('evaluates jobs added after mount (reads store at tick time)', () => {
    const mock = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useCron(onFire));

    const late = job();
    act(() => { useCronStore.setState({ jobs: [late] }); });
    mock.tick(NINE_AM);

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  // Regression: the hook used to re-register a new ipcRenderer listener every
  // time the jobs array changed (including via its own markRan call), and the
  // preload had no unsubscribe — so each matching job fired once per
  // accumulated listener on every tick.
  it('registers exactly one listener even as jobs change and ticks fire', () => {
    const mock = installMinuteTickMock();
    useCronStore.setState({ jobs: [job({ expression: '* * * * *' })] });

    const onFire = vi.fn();
    renderHook(() => useCron(onFire));

    mock.tick(NINE_AM);            // markRan mutates jobs → old code re-registered here
    mock.tick(NINE_AM + 60_000);
    act(() => { useCronStore.setState({ jobs: [...useCronStore.getState().jobs, job()] }); });
    mock.tick(NINE_AM + 120_000);

    expect(mock.listenerCount()).toBe(1);
    // '* * * * *' matches every tick (the job added mid-test never matches):
    // exactly one firing per tick, no duplicates
    expect(onFire).toHaveBeenCalledTimes(3);
  });

  it('unsubscribes on unmount', () => {
    const mock = installMinuteTickMock();
    const { unmount } = renderHook(() => useCron(vi.fn()));
    expect(mock.listenerCount()).toBe(1);
    unmount();
    expect(mock.listenerCount()).toBe(0);
  });

  it('uses the latest onFire callback without re-registering', () => {
    const mock = installMinuteTickMock();
    useCronStore.setState({ jobs: [job({ expression: '* * * * *' })] });

    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useCron(cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    mock.tick(NINE_AM);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(mock.listenerCount()).toBe(1);
  });

  it('is a no-op outside Electron (no electronAPI)', () => {
    window.electronAPI = undefined;
    expect(() => renderHook(() => useCron(vi.fn()))).not.toThrow();
  });
});
