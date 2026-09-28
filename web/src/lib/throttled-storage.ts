import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * A zustand `persist` storage that does not write the whole transcript on every
 * token.
 *
 * `persist` serialises the ENTIRE partialized state on every `set`, and a
 * streaming reply is one `set` per chunk — so a long conversation was
 * JSON-stringified and written to localStorage dozens of times a second, on the
 * main thread, while the user watched the reply stutter. The value is handed to
 * this storage as an object, so the expensive part (stringify) can be deferred
 * along with the write.
 *
 * While `isBusy()` (a turn is streaming) writes coalesce to at most one per
 * `intervalMs`, always of the latest value; otherwise they go straight through,
 * so the end of a turn — which clears the busy flag in the same `set` — is
 * persisted at once. Pending writes are flushed on page hide.
 *
 * QUOTA. localStorage is one ~5MB budget shared by every store (see
 * lib/runs/run-log.ts for why run records left it). A write that does not fit
 * throws, and a throw from `setItem` propagates out of `set` — into whichever
 * stream chunk handler happened to call it, killing the turn. The in-memory
 * state is already updated by then and is the thing worth keeping, so a quota
 * failure is reported once and the next write simply tries again.
 */
export interface ThrottledStorageOptions {
  /** True while writes should be coalesced (a turn is streaming). */
  isBusy: () => boolean;
  intervalMs?: number;
  /** Called when a write is refused for lack of space. Defaults to a one-time console warning. */
  onQuotaExceeded?: (name: string, error: unknown) => void;
}

export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

export function createThrottledJSONStorage<S>(
  getStorage: () => Storage,
  opts: ThrottledStorageOptions,
): PersistStorage<S> {
  const interval = opts.intervalMs ?? 2000;
  const pending = new Map<string, StorageValue<S>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastWrite = new Map<string, number>();
  const warned = new Set<string>();

  const reportQuota =
    opts.onQuotaExceeded ??
    ((name: string, error: unknown) => {
      if (warned.has(name)) return;
      warned.add(name);
      console.warn(
        `[storage] "${name}" no longer fits in local storage; changes are kept in memory for this session.`,
        error,
      );
    });

  function write(name: string) {
    const t = timers.get(name);
    if (t !== undefined) clearTimeout(t);
    timers.delete(name);
    const value = pending.get(name);
    if (!value) return;
    pending.delete(name);
    lastWrite.set(name, Date.now());
    try {
      getStorage().setItem(name, JSON.stringify(value));
    } catch (error) {
      if (isQuotaError(error)) reportQuota(name, error);
      else console.error(`[storage] could not persist "${name}"`, error);
    }
  }

  function flushAll() {
    for (const name of [...pending.keys()]) write(name);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('beforeunload', flushAll);
  }

  return {
    getItem: (name) => {
      const raw = getStorage().getItem(name);
      return raw === null ? null : (JSON.parse(raw) as StorageValue<S>);
    },
    setItem: (name, value) => {
      pending.set(name, value);
      if (!opts.isBusy()) {
        write(name);
        return;
      }
      if (timers.has(name)) return; // a write is already scheduled; it will take the latest value
      const wait = Math.max(0, interval - (Date.now() - (lastWrite.get(name) ?? 0)));
      timers.set(name, setTimeout(() => write(name), wait));
    },
    removeItem: (name) => {
      pending.delete(name);
      const t = timers.get(name);
      if (t !== undefined) clearTimeout(t);
      timers.delete(name);
      getStorage().removeItem(name);
    },
  };
}
