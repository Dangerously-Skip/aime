import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * May a feature be rooted at this directory?
 *
 * A COARSE gate — it does not replace the per-request containment that confines
 * a preview server or a goal run to the root it was given. What it stops is that
 * root being chosen as `/` or `/etc` in the first place, which no containment
 * below could recover from.
 *
 * WHY REAL PATHS. The literal-prefix version of this refused every folder under
 * `/tmp` on macOS, where `/tmp` is a symlink to `/private/tmp` and the folder
 * picker hands back the RESOLVED path. `/private/tmp/x`.startsWith('/tmp/') is
 * false, so the first real goal run was rejected with a flat "Forbidden" while a
 * curl to the same folder spelled `/tmp/x` sailed through. Both sides are
 * resolved here, so the check is about the directory rather than about how it
 * was spelled.
 *
 * The same reasoning applies to a home directory reached through a symlinked
 * volume, which is not exotic on a machine with a relocated home.
 */

/** Roots a user-chosen working folder may live under. */
async function allowedRoots(): Promise<string[]> {
  const candidates = [os.homedir(), os.tmpdir(), '/tmp'];
  const resolved = await Promise.all(
    candidates.map(async (c) => {
      try {
        return await fs.realpath(c);
      } catch {
        // A root that does not exist cannot contain anything; keeping the
        // literal is harmless and avoids dropping it silently.
        return path.resolve(c);
      }
    }),
  );
  return [...new Set(resolved)];
}

/**
 * Resolve as far as the filesystem allows.
 *
 * `realpath` throws on a path that does not exist yet, which a working folder
 * legitimately might — so fall back to resolving the deepest ancestor that does
 * and re-appending the rest. Returning the unresolved path instead would
 * reintroduce exactly the `/tmp` vs `/private/tmp` mismatch for a folder about
 * to be created.
 */
async function realpathOrNearest(target: string): Promise<string> {
  let current = path.resolve(target);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export async function isAllowedWorkspaceRoot(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const resolved = await realpathOrNearest(candidate);
  for (const root of await allowedRoots()) {
    // The root ITSELF counts — a user may reasonably work in their home folder.
    if (resolved === root) return true;
    if (resolved.startsWith(root + path.sep)) return true;
  }
  return false;
}
