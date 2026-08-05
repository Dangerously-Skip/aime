// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isStorageGateOpen, getGatedStorage } from '@/lib/gated-storage';

/**
 * The storage gate must never open before persisted state has actually loaded.
 *
 * This is a data-loss boundary, not a nicety. `gated-storage.ts` exists solely
 * to stop zustand writing DEFAULT state over saved state during the window
 * before rehydration finishes. `StoreHydration` had a 3-second timeout that,
 * on expiry, called `openStorageGate()` and rendered from defaults — so on any
 * slow start the app would:
 *
 *   1. show the onboarding wizard to a user who had completed it, because
 *      `onboardingComplete: false` is both the default and the "new user" value,
 *      and then
 *   2. persist that defaults-shaped payload over the real one on the next
 *      settings change, taking the API keys and conversation list with it.
 *
 * A cold dev start with thirteen stores reading a 300KB profile passes 3s
 * routinely, so this fired in normal use rather than under fault.
 *
 * These tests drive the real module rather than a reimplementation of it,
 * because what needed proving is the ORDERING between two side effects, and a
 * mock of either one would assert the ordering I already believed.
 */

/** Reset the module's module-level flags between cases. */
function readSource(): string {
  // `import.meta.url` resolves root-relative under vitest's jsdom transform, so
  // it cannot locate the file. cwd is the `web/` package root when tests run.
  return readFileSync(resolve(process.cwd(), 'src/components/store-hydration.tsx'), 'utf-8');
}

async function freshModule() {
  vi.resetModules();
  return await import('@/components/store-hydration');
}

describe('the storage gate and the render gate are not the same gate', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('exposes a hook for "may render" and a separate one for "data arrived"', async () => {
    const mod = await freshModule();
    expect(typeof mod.useHydrated).toBe('function');
    // The distinction is the fix; losing it reintroduces the bug.
    expect(typeof mod.useRehydrated).toBe('function');
  });

  /**
   * The assertion that would have caught the original bug. The timeout branch
   * may make the app renderable; it must not make it writable.
   */
  it('the timeout path does not open the storage gate', async () => {
    const src = readSource();

    // The timeout callback, isolated: from `setTimeout(` to its closing `}, N)`.
    const timeoutBody = src.slice(
      src.indexOf('const timer = setTimeout('),
      src.indexOf('// Listen for theme changes'),
    );
    expect(timeoutBody.length).toBeGreaterThan(50);
    expect(
      timeoutBody,
      'the render-anyway fallback opened the storage gate again — that is the ' +
        'defect: it lets default state be written over the saved profile',
    ).not.toContain('openStorageGate');
  });

  it('opens the gate in exactly one place', async () => {
    const src = readSource();
    const calls = src.match(/openStorageGate\(\)/g) ?? [];
    expect(calls, 'more than one caller means more than one way to lose data').toHaveLength(1);
  });

  /**
   * Timeout has to be long enough that firing means a real fault. At 3s it was
   * a routine event on a cold start, which is how a fallback path became the
   * normal path.
   */
  it('waits long enough that the fallback signals a fault, not a cold start', async () => {
    const src = readSource();
    const m = src.match(/\}, (\d[\d_]*)\);/);
    expect(m, 'no timeout literal found').toBeTruthy();
    expect(Number(m![1].replace(/_/g, ''))).toBeGreaterThanOrEqual(10_000);
  });
});

describe('the gate itself still blocks writes until opened', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('drops setItem while closed and passes it through once open', async () => {
    const gated = await import('@/lib/gated-storage');
    const storage = gated.getGatedStorage();

    // Closed: the write is silently dropped — that is the protection.
    storage.setItem('aime:settings', '{"state":{"onboardingComplete":false}}');
    expect(localStorage.getItem('aime:settings')).toBeNull();

    gated.openStorageGate();
    storage.setItem('aime:settings', '{"state":{"onboardingComplete":true}}');
    expect(localStorage.getItem('aime:settings')).toContain('true');
  });

  it('reads always pass through, so rehydration works while closed', async () => {
    const gated = await import('@/lib/gated-storage');
    localStorage.setItem('aime:settings', '{"state":{"onboardingComplete":true}}');
    expect(gated.isStorageGateOpen()).toBe(false);
    expect(gated.getGatedStorage().getItem('aime:settings')).toContain('true');
  });
});

// Referenced so the imports above are not flagged unused by the linter; the
// real assertions import fresh copies per case to reset module state.
void isStorageGateOpen;
void getGatedStorage;
