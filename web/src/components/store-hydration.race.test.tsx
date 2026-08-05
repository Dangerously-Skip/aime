// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

/**
 * The 3-second hydration timeout must not let a late rehydrate clobber state the
 * user has already changed.
 *
 * Reported symptom: stuck on the final onboarding screen — click "Get started",
 * nothing happens. It reproduced on neither Chromium nor real Electron with a
 * cleared profile, because it needs storage slow enough to miss the timeout.
 *
 * The sequence:
 *   1. rehydrate() issues its read; storage is slow (a large or lock-contended
 *      LevelDB-backed partition), so it does not resolve within 3s.
 *   2. The timeout fallback fires: gate opened, hydration announced, stores still
 *      holding DEFAULTS — so onboardingComplete is false and the wizard shows.
 *   3. The user clicks Get started; onboardingComplete becomes true and persists.
 *   4. The slow read finally resolves carrying its PRE-CLICK snapshot, and
 *      zustand applies it — reverting onboardingComplete to false. The wizard
 *      returns, and every subsequent click loses the same race.
 *
 * Anything the user did in that window is lost the same way; onboarding is just
 * where it is most visible, because the wizard gates the whole app.
 */

/** Longer than the render-anyway fallback, which is now 15s (was 3s). */
const SLOW_MS = 20_000;

let store: Record<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  store = {
    'aime:settings': JSON.stringify({
      version: 11,
      state: { displayName: 'Adam', onboardingComplete: false, onboardingSkippedAt: null },
    }),
  };

  // localStorage whose READS are slow — the condition the timeout exists for.
  const slowStorage: Storage = {
    get length() { return Object.keys(store).length; },
    clear: () => { store = {}; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  vi.stubGlobal('localStorage', slowStorage);
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('StoreHydration — the timeout must not clobber user changes', () => {
  it('a rehydrate that resolves after the fallback does not revert onboardingComplete', async () => {
    const { StoreHydration, useHydrated } = await import('./store-hydration');
    const { useSettingsStore } = await import('@/stores/settings-store');

    // Make the settings rehydrate resolve only after the fallback has fired,
    // carrying the stale pre-click snapshot — exactly step 1 above.
    const realRehydrate = useSettingsStore.persist.rehydrate.bind(useSettingsStore.persist);
    let releaseSlowRead: () => void = () => {};
    const slowRead = new Promise<void>((res) => { releaseSlowRead = res; });
    vi.spyOn(useSettingsStore.persist, 'rehydrate').mockImplementation(
      async () => { await slowRead; return realRehydrate(); },
    );

    function Probe() { return <span data-testid="h">{String(useHydrated())}</span>; }
    render(<StoreHydration><Probe /></StoreHydration>);

    // 2. the fallback fires with defaults
    await vi.advanceTimersByTimeAsync(15_100);
    expect(useSettingsStore.getState().onboardingComplete).toBe(false);

    // 3. the user completes onboarding
    useSettingsStore.getState().setOnboardingComplete(true);
    expect(useSettingsStore.getState().onboardingComplete).toBe(true);

    // 4. the slow read lands, carrying onboardingComplete: false
    releaseSlowRead();
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    // The user's change must survive. Reverting it is what strands them on the
    // final onboarding screen.
    expect(useSettingsStore.getState().onboardingComplete).toBe(true);
  }, 20_000);
});
