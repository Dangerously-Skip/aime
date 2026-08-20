/**
 * Where a harness run keeps its state.
 *
 * WHY THIS EXISTS. The harness was built for Cowork and Code, where a run has a
 * working directory and `node:fs` is available, so `ledger.ts` reads and writes
 * files directly. That is the right default and it stays the default.
 *
 * It does not fit the browser. Browser tools execute in the RENDERER — they need
 * the live `<webview>` — while the harness loop runs on the SERVER, and the
 * browser surface has no working directory to key anything on. Driving it from
 * the server would mean a round trip per tool call, and a browsing run makes
 * dozens; the latency lands directly on task success, because a slower run is a
 * run that times out or gets abandoned.
 *
 * So the loop moves to the renderer and the STORAGE becomes the thing that
 * varies. One core, two backings.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: there must be exactly one harness.
 *
 * This codebase's recurring wound is two implementations of one idea drifting
 * apart — four places once picked a model, two systems described panels, and a
 * loop detector was rewritten rather than shared until it was extracted this
 * week. A second harness for the browser would be the same mistake with more
 * moving parts. The plan, the stop reasons, the verifier gate and the ledger
 * semantics are shared code; only `readText`/`writeText` differ.
 *
 * The interface is deliberately dumb — a string keyed store, no transactions, no
 * queries. Everything clever already lives in `ledger.ts` as pure functions over
 * parsed values, and it should stay there where it is testable without I/O.
 */

export interface HarnessStore {
  /** File contents, or null when absent. Absent is normal, not an error. */
  readText(key: string): Promise<string | null>;
  /**
   * Write, replacing. Implementations should be atomic where the medium allows
   * it — a half-written ledger is worse than a missing one, because the loop
   * will parse it.
   */
  writeText(key: string, contents: string): Promise<void>;
  /** Append, creating if absent. Used by the progress log, which is append-only. */
  appendText(key: string, contents: string): Promise<void>;
  /** Remove. Absent is success — the caller wanted it gone and it is gone. */
  remove(key: string): Promise<void>;
  /** Keys currently present. Order is not guaranteed. */
  keys(): Promise<string[]>;
}

/**
 * An in-memory store.
 *
 * Used by the renderer-side loop and by tests. Tests are the reason it is worth
 * having on its own terms: the fs-backed harness suite currently writes to
 * temporary directories, which is slower and gives a test a way to fail for
 * reasons that have nothing to do with the harness.
 */
export function memoryStore(seed: Record<string, string> = {}): HarnessStore {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    async readText(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    async writeText(key, contents) {
      data.set(key, contents);
    },
    async appendText(key, contents) {
      data.set(key, (data.get(key) ?? '') + contents);
    },
    async remove(key) {
      data.delete(key);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}

/**
 * A store backed by `localStorage`, for a browser run that should survive a
 * reload.
 *
 * Namespaced by run so two runs cannot read each other's ledger — the same
 * separation the filesystem gets from having a directory per run.
 *
 * Deliberately degrades to memory when `localStorage` is unavailable or full
 * rather than throwing: losing persistence costs the user a resumable run,
 * whereas throwing costs them the run itself. A quota failure mid-write is the
 * realistic case, and it should not take the loop down.
 */
export function localStorageStore(namespace: string): HarnessStore {
  const prefix = `aime:harness:${namespace}:`;
  const fallback = memoryStore();

  const available = (): boolean => {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  };

  if (!available()) return fallback;

  return {
    async readText(key) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return fallback.readText(key);
      }
    },
    async writeText(key, contents) {
      try {
        localStorage.setItem(prefix + key, contents);
      } catch {
        // Quota, private mode, or a disabled store. Keep the run alive.
        await fallback.writeText(key, contents);
      }
    },
    async appendText(key, contents) {
      const existing = (await this.readText(key)) ?? '';
      await this.writeText(key, existing + contents);
    },
    async remove(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        await fallback.remove(key);
      }
    },
    async keys() {
      try {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
        }
        return out;
      } catch {
        return fallback.keys();
      }
    },
  };
}
