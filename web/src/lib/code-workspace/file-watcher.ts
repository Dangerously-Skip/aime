/**
 * Renderer-side file-watcher coordinator.
 *
 * The actual chokidar instance lives in the Electron main process (see
 * `web/lib/code-workspace-fs.js` peer + `main-web.js` IPC handlers). This
 * module owns subscription bookkeeping in the renderer: callers register a
 * listener for a given workspace and we de-dup / fan-out fs:change events.
 */

import {
  onFsChange,
  watchPath,
  unwatchPath,
} from "./ipc";

export type FsChangeKind = "add" | "change" | "delete";
export interface FsChangeEvent {
  watchId: string;
  path: string;
  kind: FsChangeKind;
}

type Listener = (evt: FsChangeEvent) => void;

interface WatchRegistration {
  workspace: string;
  watchId: string;
  listeners: Set<Listener>;
  /** Unsubscribe handle for the underlying onFsChange call. */
  unsubscribe: () => void;
}

const registry = new Map<string, WatchRegistration>();
/**
 * Watchers being started. Without this, two subscribers mounting in the same
 * tick (the file tree and an open editor tab) both missed the registry, both
 * started a chokidar watcher, and the first one leaked.
 */
const starting = new Map<string, Promise<WatchRegistration | null>>();

async function register(workspace: string): Promise<WatchRegistration | null> {
  const watchId = await watchPath(workspace);
  if (!watchId) return null;
  const listeners = new Set<Listener>();
  const unsubscribe = onFsChange((evt) => {
    if (evt.watchId !== watchId) return;
    for (const l of listeners) {
      try {
        l(evt);
      } catch {
        // ignore listener errors
      }
    }
  });
  const reg = { workspace, watchId, listeners, unsubscribe };
  registry.set(workspace, reg);
  return reg;
}

/**
 * Subscribe to fs changes for a workspace. Lazily creates a single shared
 * watcher per workspace path; multiple subscribers share the same chokidar
 * instance via the registry.
 */
export async function subscribe(
  workspace: string,
  listener: Listener,
): Promise<() => void> {
  let reg = registry.get(workspace) ?? null;
  if (!reg) {
    let pending = starting.get(workspace);
    if (!pending) {
      pending = register(workspace).finally(() => starting.delete(workspace));
      starting.set(workspace, pending);
    }
    reg = await pending;
    // No bridge available (e.g. running in browser SSR). Return a no-op.
    if (!reg) return () => {};
  }

  reg.listeners.add(listener);

  return () => {
    const r = registry.get(workspace);
    if (!r) return;
    r.listeners.delete(listener);
    if (r.listeners.size === 0) {
      r.unsubscribe();
      // Fire-and-forget; the renderer doesn't need to await teardown.
      void unwatchPath(r.watchId);
      registry.delete(workspace);
    }
  };
}

/** Debounce a function call by `wait` ms. */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}
