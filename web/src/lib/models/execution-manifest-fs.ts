import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir } from '@/lib/app-paths';
import {
  MANIFEST_FILENAME,
  parseManifest,
  type ExecutionManifest,
} from './execution-manifest';

/**
 * Where the manifest lives, and how it is read.
 *
 * Kept apart from `execution-manifest.ts` so the decision logic stays pure and
 * testable without a filesystem — the same split as `harness/ledger-core`, and
 * for the same reason: the interesting failures are in the parsing, not the I/O.
 *
 * NEXT TO THE CREDENTIAL STORE, deliberately. It is the other half of the same
 * answer ("which provider, and with what key"), it has the same lifetime, and a
 * user clearing their data should lose both together. It is PLAIN JSON where the
 * credentials are encrypted, which is correct — a selection is configuration and
 * a key is not — and `execution-manifest.ts` strips secret-shaped fields on both
 * the way in and the way out so that stays true.
 */

export function getManifestPath(): string {
  return path.join(getDataDir(), MANIFEST_FILENAME);
}

/**
 * The manifest, or null.
 *
 * NULL FOR EVERY FAILURE — absent, unreadable, corrupt, wrong version. Callers
 * skip on null, and skipping is always safe; a scheduled refresh that does not
 * run is a visible gap, while one that runs against a guessed model is a 400 per
 * tick that nobody sees.
 */
export async function readExecutionManifest(): Promise<ExecutionManifest | null> {
  let text: string;
  try {
    text = await fs.readFile(getManifestPath(), 'utf8');
  } catch {
    // Absent is the normal state before the user has configured anything.
    return null;
  }
  try {
    return parseManifest(JSON.parse(text));
  } catch {
    console.warn('[models] execution manifest is not valid JSON — ignoring it');
    return null;
  }
}

/**
 * Write the manifest.
 *
 * Atomic: a half-written file would parse as corrupt and take scheduled work
 * offline until the next settings change, and the window for that is every save.
 */
export async function writeExecutionManifest(manifest: ExecutionManifest): Promise<void> {
  const target = getManifestPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}
