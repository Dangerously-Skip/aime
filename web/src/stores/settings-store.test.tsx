// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { useSettingsStore, DEFAULT_HEARTBEAT_MODES } from './settings-store';

const KEY = 'nibcowork:settings';

// jsdom 29 (under vitest) ships sessionStorage but no localStorage —
// provide an in-memory Storage so gated-storage/zustand persist work.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

beforeAll(() => {
  vi.stubGlobal('localStorage', makeMemoryStorage());
});

/** Seed a versioned persisted payload and run the real rehydrate+migrate pipeline. */
async function rehydrateWith(version: number, state: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
  await useSettingsStore.persist.rehydrate();
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().resetAll();
});

describe('settings migrations', () => {
  it('v1 → current: adds security defaults and fills newer fields from initial state', async () => {
    await rehydrateWith(1, { fullName: 'Adam', chatFont: 'mono' });

    const s = useSettingsStore.getState();
    expect(s.fullName).toBe('Adam');                       // persisted value kept
    expect(s.chatFont).toBe('mono');
    expect(s.blockDangerousCommands).toBe(true);           // v1→v2 patch
    expect(s.restrictToProjectFolder).toBe(true);
    expect(s.heartbeatModes).toEqual(DEFAULT_HEARTBEAT_MODES); // filled by merge
    expect(s.devHourlyRate).toBe(150);
    expect(s.onboardingComplete).toBe(false);
  });

  it('v4 → current: replaces interval heartbeat with mode-based config', async () => {
    await rehydrateWith(4, { fullName: 'Eve', heartbeatEnabled: true, heartbeatIntervalMinutes: 15 });

    const s = useSettingsStore.getState();
    expect(s.heartbeatModes).toEqual(DEFAULT_HEARTBEAT_MODES);
    expect(s.fullName).toBe('Eve');
  });

  it('v5 → v6: adds devHourlyRate', async () => {
    await rehydrateWith(5, { fullName: 'Kim' });
    expect(useSettingsStore.getState().devHourlyRate).toBe(150);
  });

  it('current version passes through untouched', async () => {
    await rehydrateWith(6, { fullName: 'Zoe', devHourlyRate: 200, onboardingComplete: true });

    const s = useSettingsStore.getState();
    expect(s.fullName).toBe('Zoe');
    expect(s.devHourlyRate).toBe(200);
    expect(s.onboardingComplete).toBe(true);
  });
});

describe('settings actions', () => {
  it('addRecentFolder deduplicates, prepends, and caps at 10', () => {
    const s = () => useSettingsStore.getState();
    for (let i = 0; i < 12; i++) s().addRecentFolder(`/proj/${i}`);
    expect(s().recentFolders).toHaveLength(10);
    expect(s().recentFolders[0]).toBe('/proj/11');

    s().addRecentFolder('/proj/5'); // re-adding moves to front without duplicating
    expect(s().recentFolders[0]).toBe('/proj/5');
    expect(s().recentFolders.filter((f) => f === '/proj/5')).toHaveLength(1);
  });

  it('addTrustedFolder ignores duplicates and caps at 100 (dropping oldest)', () => {
    const s = () => useSettingsStore.getState();
    s().addTrustedFolder('/keep');
    s().addTrustedFolder('/keep');
    expect(s().trustedFolders).toEqual(['/keep']);

    for (let i = 0; i < 100; i++) s().addTrustedFolder(`/t/${i}`);
    expect(s().trustedFolders).toHaveLength(100);
    expect(s().trustedFolders).not.toContain('/keep'); // oldest dropped
    expect(s().trustedFolders.at(-1)).toBe('/t/99');
  });

  it('clearGithubAuth wipes token and user together', () => {
    const s = () => useSettingsStore.getState();
    s().setGithubToken('gh-token');
    s().setGithubUser('adam');
    s().clearGithubAuth();
    expect(s().githubToken).toBeNull();
    expect(s().githubUser).toBeNull();
  });

  it('resetAll restores initial state', () => {
    const s = () => useSettingsStore.getState();
    s().setFullName('Someone');
    s().setDevHourlyRate(999);
    s().resetAll();
    expect(s().fullName).toBe('');
    expect(s().devHourlyRate).toBe(150);
  });
});
