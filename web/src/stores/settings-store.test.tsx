// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import {
  useSettingsStore,
  DEFAULT_HEARTBEAT_MODES,
  INITIAL_SETTINGS,
  PERSISTED_SETTINGS_KEYS,
  EPHEMERAL_SETTINGS_KEYS,
} from './settings-store';
import { openStorageGate } from '@/lib/gated-storage';

const KEY = 'aime:settings';
const LEGACY_KEY = 'nibcowork:settings';

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

  // Regression for the Quarry → AIME rename: pre-rename installs persisted
  // under nibcowork:*; rehydration must pick those up via the storage fallback.
  it('rehydrates from a legacy nibcowork:settings key', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ state: { fullName: 'Legacy User' }, version: 6 }));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().fullName).toBe('Legacy User');
  });

  it('v6 → v7: renames nibGatewayApiKey to anthropicApiKey', async () => {
    await rehydrateWith(6, { fullName: 'Kai', nibGatewayApiKey: 'sk-team-key' });
    const s = useSettingsStore.getState();
    expect(s.anthropicApiKey).toBe('sk-team-key');
    expect((s as unknown as Record<string, unknown>).nibGatewayApiKey).toBeUndefined();
  });

  it('v7 → v8: backfills per-surface tier overrides', async () => {
    await rehydrateWith(7, { fullName: 'Ash' });
    expect(useSettingsStore.getState().surfaceTiers).toEqual({});
  });

  it('v8 preserves a stored tier override', async () => {
    await rehydrateWith(8, { fullName: 'Ira', surfaceTiers: { cowork: 'stallion' } });
    expect(useSettingsStore.getState().surfaceTiers).toEqual({ cowork: 'stallion' });
  });

  it('v8 → v9: backfills tier model assignments', async () => {
    await rehydrateWith(8, { fullName: 'Rae', surfaceTiers: { cowork: 'smort' } });
    const s = useSettingsStore.getState();
    expect(s.tierModels).toEqual({});
    expect(s.surfaceTiers).toEqual({ cowork: 'smort' }); // earlier field preserved
  });

  it('v9 preserves stored tier model assignments', async () => {
    await rehydrateWith(9, { fullName: 'Bo', tierModels: { smort: 'or-1:kimi-k2' } });
    expect(useSettingsStore.getState().tierModels).toEqual({ smort: 'or-1:kimi-k2' });
  });

  it('current version passes through untouched', async () => {
    await rehydrateWith(11, { fullName: 'Zoe', devHourlyRate: 200, onboardingComplete: true });

    const s = useSettingsStore.getState();
    expect(s.fullName).toBe('Zoe');
    expect(s.devHourlyRate).toBe(200);
    expect(s.onboardingComplete).toBe(true);
  });
});

/**
 * v11: the org "select your team" concept moved to a separate product. The key
 * has to be DROPPED, not just removed from the type: zustand's default merge
 * splices every persisted field into live state, so an orphan `teamId` would sit
 * in the store — invisible to `partialize`, absent from the type, and still
 * there — until some later write happened to overwrite the payload.
 */
describe('v11 — the teamId key is dropped', () => {
  const teamIdOf = (s: unknown) => (s as Record<string, unknown>).teamId;

  it('drops a persisted teamId without disturbing the other keys', async () => {
    await rehydrateWith(10, {
      teamId: 'nib-digital',
      fullName: 'Rory',
      displayName: 'Ro',
      anthropicApiKey: 'sk-ant-keepme',
      onboardingComplete: true,
      devHourlyRate: 220,
      surfaceTiers: { cowork: 'smort' },
      tierModels: { smort: 'or-1:kimi-k2' },
      pushToTalkEnabled: true,
    });

    const s = useSettingsStore.getState();
    expect(teamIdOf(s)).toBeUndefined();
    // everything else survives the drop
    expect(s.fullName).toBe('Rory');
    expect(s.displayName).toBe('Ro');
    expect(s.anthropicApiKey).toBe('sk-ant-keepme');
    expect(s.onboardingComplete).toBe(true);
    expect(s.devHourlyRate).toBe(220);
    expect(s.surfaceTiers).toEqual({ cowork: 'smort' });
    expect(s.tierModels).toEqual({ smort: 'or-1:kimi-k2' });
    expect(s.pushToTalkEnabled).toBe(true);
  });

  it('drops it from the oldest payloads too, not just v10', async () => {
    // The v2/v3 branches return early, so a per-version branch would have
    // missed these — the delete has to happen up front.
    for (const version of [1, 2, 3, 6, 9]) {
      localStorage.clear();
      useSettingsStore.getState().resetAll();
      await rehydrateWith(version, { teamId: 'nib-digital', fullName: `v${version}` });

      const s = useSettingsStore.getState();
      expect(teamIdOf(s)).toBeUndefined();
      expect(s.fullName).toBe(`v${version}`);
    }
  });

  it('the dropped key never gets written back to storage', async () => {
    openStorageGate();
    await rehydrateWith(10, { teamId: 'nib-digital', fullName: 'Rory' });
    useSettingsStore.getState().setFullName('Rory Two');

    const persisted = (JSON.parse(localStorage.getItem(KEY)!) as { state: Record<string, unknown> }).state;
    expect(persisted).not.toHaveProperty('teamId');
    expect(persisted.fullName).toBe('Rory Two');
  });

  it('has no setTeamId action left to call', () => {
    expect(teamIdOf(useSettingsStore.getState())).toBeUndefined();
    expect((useSettingsStore.getState() as unknown as Record<string, unknown>).setTeamId).toBeUndefined();
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

describe('v10 — push-to-talk settings', () => {
  it('a v9 payload gains the new fields with safe defaults', async () => {
    // Additive migration: the absent fields must arrive as off + the default
    // accelerator rather than undefined, since an undefined accelerator would
    // reach globalShortcut.register.
    await rehydrateWith(9, { displayName: 'Ada', toolProfile: 'full' });

    const s = useSettingsStore.getState();
    expect(s.displayName).toBe('Ada');
    expect(s.pushToTalkEnabled).toBe(false);
    expect(s.pushToTalkAccelerator).toBe('CommandOrControl+Shift+Space');
  });

  it('never claims a global hotkey by default', async () => {
    // A system-wide key grabbed uninvited makes users think another app broke.
    await rehydrateWith(10, {});
    expect(useSettingsStore.getState().pushToTalkEnabled).toBe(false);
  });

  it('stores the canonical accelerator form, not what was typed', () => {
    const result = useSettingsStore.getState().setPushToTalkAccelerator('shift + ctrl + k');
    expect(result.ok).toBe(true);
    expect(useSettingsStore.getState().pushToTalkAccelerator).toBe('Control+Shift+K');
  });

  it('refuses an invalid accelerator and leaves the stored one alone', () => {
    useSettingsStore.getState().setPushToTalkAccelerator('Ctrl+Shift+J');
    const result = useSettingsStore.getState().setPushToTalkAccelerator('V');
    expect(result.ok).toBe(false);
    expect(useSettingsStore.getState().pushToTalkAccelerator).toBe('Control+Shift+J');
  });
});

/**
 * DEFECT 3 regression: the v10 version bump existed for two fields that could
 * not survive a reload, because `partialize` never listed them. A migration for
 * a field that is never written is a no-op dressed as a feature.
 *
 * These tests run the REAL gated storage and the REAL rehydrate pipeline; a
 * mocked storage would have agreed with the broken code.
 */
describe('persistence — what actually survives a reload', () => {
  // Writes are gated until StoreHydration opens them in the app; open the gate
  // so this block exercises the write half too, not only reads.
  beforeAll(() => openStorageGate());

  /** What the current session has committed to storage. */
  function persistedState(): Record<string, unknown> {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('nothing was persisted');
    return (JSON.parse(raw) as { state: Record<string, unknown> }).state;
  }

  it('persists push-to-talk enablement and the chosen accelerator', () => {
    const s = () => useSettingsStore.getState();
    s().setPushToTalkEnabled(true);
    expect(s().setPushToTalkAccelerator('Ctrl+Alt+K').ok).toBe(true);

    expect(persistedState()).toMatchObject({
      pushToTalkEnabled: true,
      pushToTalkAccelerator: 'Control+Alt+K',
    });
  });

  it('round-trips them through a fresh session', async () => {
    const s = () => useSettingsStore.getState();
    s().setPushToTalkEnabled(true);
    s().setPushToTalkAccelerator('Ctrl+Alt+K');
    const fromSessionOne = localStorage.getItem(KEY)!;

    // Session 2: a fresh store, reading what session 1 wrote.
    s().resetAll();
    expect(s().pushToTalkEnabled).toBe(false);
    localStorage.setItem(KEY, fromSessionOne);
    await useSettingsStore.persist.rehydrate();

    expect(s().pushToTalkEnabled).toBe(true);
    expect(s().pushToTalkAccelerator).toBe('Control+Alt+K');
  });

  it('every settings field is either persisted or explicitly declared ephemeral', () => {
    // The guard against this class of bug recurring: adding a field to state
    // (and a migration for it) without deciding whether it persists now fails
    // here, instead of silently resetting on every reload.
    const declared = new Set<string>([...PERSISTED_SETTINGS_KEYS, ...EPHEMERAL_SETTINGS_KEYS]);
    const undeclared = Object.keys(INITIAL_SETTINGS).filter((key) => !declared.has(key));
    expect(undeclared).toEqual([]);
  });

  it('writes exactly the declared persisted keys — no more, no less', () => {
    useSettingsStore.getState().setFullName('Persisted Person');
    expect(Object.keys(persistedState()).sort()).toEqual([...PERSISTED_SETTINGS_KEYS].sort());
  });
});
