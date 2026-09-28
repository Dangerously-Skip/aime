import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Where attachment bytes land in a chat's scratch directory.
 *
 * Both writers — `/api/upload` for large files and the chat route for inline
 * (base64) attachments — used to write `uploads/<sanitised name>` directly, so
 * two different `image.png` attachments in one conversation silently became
 * one: the second overwrote the first, and the model's `Read` of the first
 * path returned the second picture. Stored names are now unique per directory
 * (`image.png`, `image-2.png`, …) while the display name the user sees is kept
 * separately by the caller. The suffix avoids spaces and parentheses, so the
 * path survives being pasted unquoted into a shell command by the model.
 */

/** Largest single upload accepted, aligned with the server's request-size cap. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const MAX_NAME_LENGTH = 180;

/**
 * A filename safe to join onto a directory: `[A-Za-z0-9._-]` only, no leading
 * dots (so never `.`, `..` or a hidden file), bounded length, extension kept.
 */
export function safeUploadName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  // Last path segment only — a browser sends a bare name, but nothing enforces it.
  const base = raw.split(/[\\/]/).pop() ?? '';
  let safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  if (safe.length > MAX_NAME_LENGTH) {
    const ext = path.extname(safe).slice(0, 20);
    safe = safe.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return safe || 'file';
}

function candidate(name: string, n: number): string {
  if (n === 1) return name;
  const ext = path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  return `${stem}-${n}${ext && ext !== name ? ext : ''}`;
}

/**
 * Create an empty file at the first free `name`, `name-2`, … in `dir` and
 * return its path. Exclusive create (`wx`), so two concurrent writers of the
 * same name cannot both claim it.
 */
export async function reserveUniquePath(dir: string, name: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const safe = safeUploadName(name);
  for (let n = 1; n < 10_000; n++) {
    const target = path.join(dir, candidate(safe, n));
    try {
      const handle = await fs.open(target, 'wx', 0o600);
      await handle.close();
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`No free name for ${safe} in ${dir}`);
}

/** Write `data` under a unique name in `dir`; returns the stored path. */
export async function writeUniqueFile(dir: string, name: string, data: Uint8Array): Promise<string> {
  const target = await reserveUniquePath(dir, name);
  await fs.writeFile(target, data);
  return target;
}

/** Move an existing file (same volume) under a unique name in `dir`. */
export async function moveIntoUnique(src: string, dir: string, name: string): Promise<string> {
  const target = await reserveUniquePath(dir, name);
  await fs.rename(src, target);
  return target;
}

/** Copy an existing file under a unique name in `dir`. */
export async function copyIntoUnique(src: string, dir: string, name: string): Promise<string> {
  const target = await reserveUniquePath(dir, name);
  try {
    await fs.copyFile(src, target);
  } catch (err) {
    await fs.rm(target, { force: true });
    throw err;
  }
  return target;
}

/**
 * Is `candidate` (after resolving symlinks) inside `root`? Used before copying
 * a client-supplied attachment path: only a file this app already stored under
 * the scratch root may be referenced that way.
 */
export async function isRealPathWithin(root: string, candidatePath: unknown): Promise<string | null> {
  if (typeof candidatePath !== 'string' || !candidatePath || candidatePath.includes('\0')) return null;
  try {
    const [realRoot, real] = await Promise.all([fs.realpath(root), fs.realpath(candidatePath)]);
    const rel = path.relative(realRoot, real);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return real;
  } catch {
    return null;
  }
}
