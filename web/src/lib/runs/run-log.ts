/**
 * Append-only JSONL run log.
 *
 * WHY THIS EXISTS (revised decision — the capped client store was the wrong
 * call once judged on user experience rather than architecture):
 *
 * 1. **It cannot damage anything precious.** localStorage is a single ~5MB
 *    budget shared with conversations and messages. Run records are disposable
 *    telemetry; conversations are not. Letting the former compete with the
 *    latter risks a quota failure that costs the user their chat history to
 *    preserve a metrics list. Unacceptable trade.
 * 2. **No jank.** zustand's `persist` re-serializes the WHOLE partialized state
 *    on every change, so a 500-run array was fully stringified and written
 *    synchronously on every turn AND every status transition — on the main
 *    thread, during streaming. An append is one line.
 * 3. **It answers the actual question.** "Show me the outcomes of my scheduled
 *    work" must survive a restart and include work done while the window was
 *    shut. A renderer store can observe neither.
 * 4. **It is less code, not more** — no cap, no eviction, no per-goal budget.
 *
 * Same shape as `telemetry/event-buffer.ts`, which already does this.
 */
import { getDataDir } from '@/lib/app-paths';
import type { Run } from './types';

const RUN_LOG_FILENAME = 'runs.jsonl';

/**
 * Cap on lines read back for display. Reading is bounded, writing is not —
 * the file is the durable record, this is only what a dashboard needs.
 */
export const RUN_LOG_READ_LIMIT = 1000;

let cachedPath: string | null = null;

/** Resolve `<userData>/runs/runs.jsonl`, creating the directory. */
export async function getRunLogPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  const path = await import('path');
  const fs = await import('fs/promises');
  const userDataDir = process.env.AIME_USER_DATA_DIR;
  const dir = userDataDir ? path.join(userDataDir, 'runs') : getDataDir();
  await fs.mkdir(dir, { recursive: true });
  cachedPath = path.join(dir, RUN_LOG_FILENAME);
  return cachedPath;
}

/** Reset the memoized path. Tests only. */
export function __resetRunLogPath(): void {
  cachedPath = null;
}

/**
 * Append one run record. A run is written once on completion rather than on
 * every transition, so the log holds terminal facts and stays append-only —
 * no rewriting, no read-modify-write.
 *
 * Never throws: failing to record a run must not break the run.
 */
export async function appendRun(run: Run): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    const file = await getRunLogPath();
    await fs.appendFile(file, JSON.stringify(run) + '\n', 'utf-8');
    return true;
  } catch (err) {
    console.error('[runs] failed to append run record:', err);
    return false;
  }
}

/**
 * Read recent runs, newest first. Tolerates a partially-written trailing line
 * (a crash mid-append) and skips malformed entries rather than failing the
 * whole read — one bad line must not blank the dashboard.
 */
export async function readRuns(opts: { limit?: number; goalId?: string } = {}): Promise<Run[]> {
  const limit = Math.min(opts.limit ?? RUN_LOG_READ_LIMIT, RUN_LOG_READ_LIMIT);
  try {
    const fs = await import('fs/promises');
    const file = await getRunLogPath();
    const raw = await fs.readFile(file, 'utf-8');
    const out: Run[] = [];
    // Walk backwards so `limit` keeps the NEWEST runs, not the oldest.
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const run = JSON.parse(line) as Run;
        if (opts.goalId && run.goalId !== opts.goalId) continue;
        out.push(run);
      } catch {
        // Malformed or half-written line — skip it.
      }
    }
    return out;
  } catch (err) {
    // Missing file is the normal first-run case, not an error.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    console.error('[runs] failed to read run log:', err);
    return [];
  }
}

/**
 * Trim the log to its most recent `keep` entries. Not called on the write path
 * — compaction is a maintenance operation, so an append never pays for it.
 */
export async function compactRunLog(keep = RUN_LOG_READ_LIMIT): Promise<number> {
  try {
    const fs = await import('fs/promises');
    const file = await getRunLogPath();
    const raw = await fs.readFile(file, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    if (lines.length <= keep) return lines.length;
    const kept = lines.slice(-keep);
    await fs.writeFile(file, kept.join('\n') + '\n', 'utf-8');
    return kept.length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    console.error('[runs] failed to compact run log:', err);
    return 0;
  }
}
