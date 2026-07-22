// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHeartbeat } from './use-heartbeat';
import { useSettingsStore, DEFAULT_HEARTBEAT_MODES, type HeartbeatModes } from '@/stores/settings-store';

function installMinuteTickMock() {
  const listeners = new Set<(ts: number) => void>();
  window.electronAPI = {
    onMinuteTick: (cb: (ts: number) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  } as unknown as Window['electronAPI'];
  return {
    tick: () => act(() => { [...listeners].forEach((l) => l(Date.now())); }),
    listenerCount: () => listeners.size,
  };
}

const setModes = (modes: Partial<HeartbeatModes>) =>
  useSettingsStore.setState({ heartbeatModes: { ...DEFAULT_HEARTBEAT_MODES, ...modes } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 20, 9, 0, 0)); // 09:00 local
  useSettingsStore.setState({ heartbeatModes: DEFAULT_HEARTBEAT_MODES });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useHeartbeat', () => {
  // Regression: the effect depended on [heartbeatModes, onFire] and the
  // preload had no unsubscribe, so settings changes accumulated listeners
  // and duplicated heartbeat firings.
  it('registers exactly one listener and cleans up on unmount', () => {
    const mock = installMinuteTickMock();
    const { rerender, unmount } = renderHook(() => useHeartbeat(vi.fn()));

    act(() => setModes({ morning: { enabled: true, time: '09:00', connectors: [], idleMinutes: 0 } }));
    rerender();
    expect(mock.listenerCount()).toBe(1);

    unmount();
    expect(mock.listenerCount()).toBe(0);
  });

  it('fires the morning briefing once per day at the configured time', () => {
    const mock = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useHeartbeat(onFire));

    act(() => setModes({ morning: { enabled: true, time: '09:00', connectors: [], idleMinutes: 0 } }));
    mock.tick();
    mock.tick(); // same day + time — must not fire again

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire.mock.calls[0][0]).toContain('morning briefing');
  });

  it('does not fire the morning briefing outside the configured minute', () => {
    const mock = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useHeartbeat(onFire));

    act(() => setModes({ morning: { enabled: true, time: '09:30', connectors: [], idleMinutes: 0 } }));
    mock.tick(); // clock reads 09:00
    expect(onFire).not.toHaveBeenCalled();
  });

  it('sees settings enabled after mount (reads store at tick time)', () => {
    const mock = installMinuteTickMock();
    const onFire = vi.fn();
    renderHook(() => useHeartbeat(onFire));

    mock.tick();
    expect(onFire).not.toHaveBeenCalled();

    act(() => setModes({ idle: { enabled: true, time: '', connectors: [], idleMinutes: 2 } }));
    mock.tick();
    mock.tick();
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire.mock.calls[0][0]).toContain('checking in');
  });

  it('resetIdleTimer restarts the idle countdown', () => {
    const mock = installMinuteTickMock();
    const onFire = vi.fn();
    const { result } = renderHook(() => useHeartbeat(onFire));

    act(() => setModes({ idle: { enabled: true, time: '', connectors: [], idleMinutes: 2 } }));
    mock.tick();
    act(() => result.current.resetIdleTimer());
    mock.tick(); // only 1 minute since reset — no fire
    expect(onFire).not.toHaveBeenCalled();

    mock.tick();
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
