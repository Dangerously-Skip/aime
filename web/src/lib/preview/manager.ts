import path from 'node:path';
import { createPreviewServer, type PreviewServer } from './static-server';

/**
 * One preview server per root directory, reused across requests.
 *
 * A server per REQUEST would leak a listening socket on every preview, and a
 * single server rooted at `/` would defeat the containment that makes the whole
 * thing safe. Keying on the root is the middle: a deck folder gets one origin
 * for its lifetime, and two decks never share one.
 *
 * Held on `globalThis` because Next's dev server re-evaluates modules on edit,
 * and module-level state would strand the previous listener on its port.
 */
const KEY = Symbol.for('aime.preview.servers');

type Registry = Map<string, Promise<PreviewServer>>;

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

/** Cap the number of live roots so a long session cannot accumulate sockets. */
export const MAX_ROOTS = 8;

export async function serverForRoot(root: string): Promise<PreviewServer> {
  const resolved = path.resolve(root);
  const map = registry();

  const existing = map.get(resolved);
  if (existing) return existing;

  // Evict oldest first — Map preserves insertion order, so the first key is the
  // least recently created.
  while (map.size >= MAX_ROOTS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    const dying = map.get(oldest);
    map.delete(oldest);
    void dying?.then((s) => s.close()).catch(() => {});
  }

  const started = createPreviewServer({ root: resolved });
  map.set(resolved, started);
  // A failed start must not be cached as a permanent failure for that root.
  started.catch(() => map.delete(resolved));
  return started;
}

export async function closeAllPreviewServers(): Promise<void> {
  const map = registry();
  const all = [...map.values()];
  map.clear();
  await Promise.all(all.map((p) => p.then((s) => s.close()).catch(() => {})));
}

export function livePreviewRoots(): string[] {
  return [...registry().keys()];
}
