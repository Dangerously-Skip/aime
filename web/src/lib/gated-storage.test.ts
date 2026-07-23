import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGatedStorage, openStorageGate, isStorageGateOpen } from './gated-storage';
import { STORAGE_PREFIX, LEGACY_STORAGE_PREFIX } from '@/config/branding';

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

beforeEach(() => {
  vi.stubGlobal('localStorage', makeMemoryStorage());
});

describe('gated storage legacy-key fallback', () => {
  // Regression for the Quarry → AIME rename: existing installs persisted under
  // the legacy prefix; reads must fall back so user data survives the upgrade.
  it('reads the legacy-prefixed key when the current key is missing', () => {
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}:settings`, '{"state":{"fullName":"Adam"}}');

    const storage = getGatedStorage();
    expect(storage.getItem(`${STORAGE_PREFIX}:settings`)).toBe('{"state":{"fullName":"Adam"}}');
  });

  it('prefers the current key over the legacy one', () => {
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}:settings`, 'old');
    localStorage.setItem(`${STORAGE_PREFIX}:settings`, 'new');

    expect(getGatedStorage().getItem(`${STORAGE_PREFIX}:settings`)).toBe('new');
  });

  it('does not fall back for keys outside the app prefix', () => {
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}:other`, 'x');
    expect(getGatedStorage().getItem('unrelated:other')).toBeNull();
  });

  it('still gates writes until the gate opens', () => {
    const storage = getGatedStorage();
    if (!isStorageGateOpen()) {
      storage.setItem(`${STORAGE_PREFIX}:x`, 'blocked');
      expect(localStorage.getItem(`${STORAGE_PREFIX}:x`)).toBeNull();
    }
    openStorageGate();
    storage.setItem(`${STORAGE_PREFIX}:x`, 'written');
    expect(localStorage.getItem(`${STORAGE_PREFIX}:x`)).toBe('written');
  });
});
