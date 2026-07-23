/**
 * Gated localStorage wrapper.
 *
 * All Zustand stores with `persist` middleware subscribe to state changes
 * immediately, even when `skipHydration: true` is set.  This means any state
 * change that happens *before* rehydration will persist the default state to
 * localStorage, permanently overwriting previously saved values.
 *
 * This module wraps localStorage with a "gate" that blocks `setItem` until
 * `openStorageGate()` is called (by `StoreHydration`, after all stores have
 * been rehydrated).  Reads (`getItem`) always pass through so rehydration
 * itself works normally.
 */

import { STORAGE_PREFIX, LEGACY_STORAGE_PREFIX } from '@/config/branding';

let gateOpen = false;

/** Allow writes to localStorage.  Called by StoreHydration after rehydration. */
export function openStorageGate() {
  gateOpen = true;
}

/** Returns true when the storage gate is open (writes are allowed). */
export function isStorageGateOpen() {
  return gateOpen;
}

/**
 * Returns a `Storage`-compatible object that blocks `setItem` until the gate
 * has been opened.  Pass this to `createJSONStorage(() => getGatedStorage())`.
 */
export function getGatedStorage(): Storage {
  return {
    get length() {
      return localStorage.length;
    },
    clear: () => localStorage.clear(),
    key: (index: number) => localStorage.key(index),
    getItem: (key: string) => {
      const value = localStorage.getItem(key);
      if (value !== null) return value;
      // Legacy fallback: pre-rename installs persisted under the old prefix.
      // First write after rehydration lands on the new key; old keys are left as-is.
      if (key.startsWith(`${STORAGE_PREFIX}:`)) {
        return localStorage.getItem(
          key.replace(`${STORAGE_PREFIX}:`, `${LEGACY_STORAGE_PREFIX}:`),
        );
      }
      return null;
    },
    setItem: (key: string, value: string) => {
      if (!gateOpen) return; // Silently skip — rehydration hasn't completed yet
      localStorage.setItem(key, value);
    },
    removeItem: (key: string) => localStorage.removeItem(key),
  };
}
