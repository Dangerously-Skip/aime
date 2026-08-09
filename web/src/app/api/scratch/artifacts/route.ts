import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getScratchDir } from '@/lib/app-paths';

/**
 * List the files a turn left in its scratch directory.
 *
 * This exists because of what a killed turn loses. Artifacts are registered on
 * the CLIENT, from the `tool_use` events the stream delivers — so a `Write` that
 * completes after the stream is aborted produces a real file and no card. That
 * is not a corner case: the abort paths (stuck-tool watchdog, inactivity, Stop)
 * all cut the stream while the agent is mid-task, which is precisely when it has
 * written some things and not others.
 *
 * It happened with an 18-slide deck. The file was on disk, complete, and the UI
 * showed a timeout and an instruction to try again. The client calls this after
 * any abort and registers whatever it did not already know about.
 *
 * Read-only, and confined to one chat's own scratch directory.
 */

/** Deep enough for `documents/`, `uploads/` and a subfolder; not a repo walk. */
const MAX_DEPTH = 3;
const MAX_RESULTS = 200;

/** Working files, not deliverables — listing these adds noise, not artifacts. */
const IGNORE_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'uploads']);

interface ScratchFile {
  path: string;
  name: string;
  /** Epoch ms, so the client can keep only what this turn produced. */
  modifiedAt: number;
}

async function walk(dir: string, out: ScratchFile[], depth: number): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_RESULTS) return;

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_RESULTS) break;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await walk(full, out, depth + 1);
      continue;
    }
    // A symlink could point anywhere; `withFileTypes` reports it as neither a
    // file nor a directory, so this skips it without a separate check.
    if (!entry.isFile()) continue;

    try {
      const stat = await fs.stat(full);
      out.push({ path: full, name: entry.name, modifiedAt: stat.mtimeMs });
    } catch {
      // Raced with a delete; nothing to report.
    }
  }
}

export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('chatId');
  // The chatId becomes a path segment. Anything but a plain id is rejected
  // outright rather than sanitised — there is no legitimate `..` in a chat id,
  // so a request containing one is not a request worth repairing.
  if (!chatId || !/^[A-Za-z0-9_-]{1,128}$/.test(chatId)) {
    return NextResponse.json({ error: 'invalid chatId' }, { status: 400 });
  }

  const scratchDir = getScratchDir(chatId);

  // Resolve-then-verify: `getScratchDir` is ours, but containment is asserted
  // rather than assumed, so a future change to it cannot silently widen this.
  const resolved = path.resolve(scratchDir);
  const root = path.resolve(getScratchDir(''));
  if (!resolved.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'invalid chatId' }, { status: 400 });
  }

  const files: ScratchFile[] = [];
  await walk(resolved, files, 0);
  return NextResponse.json({ files });
}
