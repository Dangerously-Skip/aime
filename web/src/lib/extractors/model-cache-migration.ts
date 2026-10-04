import 'server-only';
/**
 * One-time move of a downloaded model out of transformers.js's in-package
 * cache (`node_modules/@huggingface/transformers/.cache/<model>`) into the app
 * data dir (see `getModelCacheDir`).
 *
 * The point is to not make an existing user download ~950 MB again just because
 * the cache moved. So: a rename when both sides are on one volume (instant, the
 * usual case); otherwise copy → verify → swap in → delete the original, logging
 * progress, because a request is waiting on it. Every failure leaves the
 * destination absent rather than half-written, and is reported, not thrown:
 * the caller's fallback is the download it would have done anyway.
 */
import * as fs from 'fs';
import * as path from 'path';

export type MigrationOutcome =
  | 'nothing-to-move'
  | 'already-present'
  | 'renamed'
  | 'copied'
  | 'failed';

interface MoveOptions {
  /** `<legacy cache>/<model>`. */
  from: string;
  /** `<new cache>/<model>`. */
  to: string;
  log?: (message: string) => void;
  /** Test seam: force the cross-volume path (a rename that fails with EXDEV). */
  rename?: (from: string, to: string) => Promise<void>;
}

interface FileEntry {
  rel: string;
  size: number;
}

/** Every regular file under `dir`, with sizes. Empty when `dir` is missing. */
async function listFiles(dir: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  async function walk(rel: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) out.push({ rel: child, size: (await fs.promises.stat(path.join(dir, child))).size });
    }
  }
  await walk('');
  return out;
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export async function moveModelCache({
  from,
  to,
  log = (message) => console.log(message),
  rename = (a, b) => fs.promises.rename(a, b),
}: MoveOptions): Promise<MigrationOutcome> {
  if (path.resolve(from) === path.resolve(to)) return 'nothing-to-move';
  if ((await listFiles(to)).length > 0) return 'already-present';
  const files = await listFiles(from);
  if (files.length === 0) return 'nothing-to-move';

  const total = files.reduce((sum, f) => sum + f.size, 0);
  const partial = `${to}.partial`;
  try {
    // An empty leftover (a download that never wrote a file) would block the rename.
    await fs.promises.rm(to, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(to), { recursive: true });

    try {
      await rename(from, to);
      log(`[Whisper] Moved the cached model (${mb(total)}) from ${from} to ${to}`);
      return 'renamed';
    } catch (err) {
      // EXDEV (another volume) is the expected one; a read-only source (EACCES,
      // EPERM — an app bundle) can still be copied from.
      const code = (err as NodeJS.ErrnoException).code ?? String(err);
      log(`[Whisper] Copying the cached model (${mb(total)}) from ${from} to ${to} — cannot rename (${code})`);
    }

    await fs.promises.rm(partial, { recursive: true, force: true });
    let copied = 0;
    let nextReport = 0.1;
    for (const file of files) {
      const dest = path.join(partial, file.rel);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(path.join(from, file.rel), dest);
      copied += file.size;
      if (total > 0 && copied / total >= nextReport) {
        log(`[Whisper] Copying the cached model: ${Math.floor((copied / total) * 100)}% (${mb(copied)} of ${mb(total)})`);
        while (copied / total >= nextReport) nextReport += 0.1;
      }
    }

    // Verify before anything is deleted: every file there, every size equal.
    for (const file of files) {
      const { size } = await fs.promises.stat(path.join(partial, file.rel));
      if (size !== file.size) throw new Error(`${file.rel}: copied ${size} bytes of ${file.size}`);
    }
    await fs.promises.rename(partial, to);

    try {
      await fs.promises.rm(from, { recursive: true, force: true });
    } catch (err) {
      // The copy is complete and in use; a source we may not delete (read-only
      // bundle) only costs disk until the next update removes it.
      log(`[Whisper] Copied the model but could not remove the original at ${from}: ${String(err)}`);
    }
    log(`[Whisper] Model cache moved to ${to}`);
    return 'copied';
  } catch (err) {
    await fs.promises.rm(partial, { recursive: true, force: true }).catch(() => {});
    log(`[Whisper] Could not move the cached model from ${from} (${err instanceof Error ? err.message : String(err)}); it will be downloaded instead`);
    return 'failed';
  }
}
