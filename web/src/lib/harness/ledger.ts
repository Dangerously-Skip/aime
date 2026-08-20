import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR_NAME } from '@/config/branding';
import { fsStore } from './store-fs';
import {
  GOAL_FILE,
  LEDGER_FILE,
  PROGRESS_FILE,
  parseGoal,
  parseLedger,
  type Goal,
  type Ledger,
  type LedgerResult,
} from './ledger-core';

/**
 * The ledger's FILESYSTEM half, plus a re-export of the pure core.
 *
 * SERVER ONLY — it imports `node:fs`. Everything that does not need a filesystem
 * lives in `ledger-core.ts`, which the renderer imports directly so a browsing
 * run can execute the same rules without dragging `fs` into the bundle.
 *
 * The re-export below is deliberate: 128 call sites import `readLedger`,
 * `writeLedger` and friends from here, and a split that renamed them would have
 * been 128 lines of churn in a module the suite leans on heavily, for no gain.
 * Existing imports keep working; new client-side code imports `ledger-core`.
 *
 * The I/O now goes through `HarnessStore` rather than calling `fs` inline, so
 * these functions and the renderer's differ only in which store they were
 * handed.
 */
export * from './ledger-core';


/**
 * Where a run's state lives.
 *
 * PER CONVERSATION, not per folder. Keying on the folder alone meant one goal
 * per project forever: a finished run occupied every new chat on that folder and
 * there was no way to start another. It was also a correctness problem — the
 * registry refuses a second run by CONVERSATION id, so two conversations on one
 * folder would both believe they owned the run and interleave ledger writes,
 * each reading the other's work as tampering.
 *
 * A missing conversation id falls back to the folder-level path, so a caller
 * that has not got one still resolves somewhere sane rather than throwing.
 */
export function harnessDir(
  workingDir: string,
  conversationId?: string | null,
  runIndex?: number,
): string {
  const base = path.join(workingDir, DATA_DIR_NAME, 'harness');
  if (!conversationId) return base;
  // A conversation id is a uuid from our own store, but it lands in a path — so
  // keep it to characters that cannot climb out of the directory.
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe) return base;
  const forConversation = path.join(base, safe);
  if (runIndex === undefined) return forConversation;
  return path.join(forConversation, String(runIndex).padStart(3, '0'));
}

/**
 * Every goal this conversation has run, oldest first.
 *
 * One goal per chat was the wrong shape: finishing something and then wanting
 * the next thing done is the normal way work goes, and forcing a new chat for it
 * throws away the context of what just happened.
 */
export async function listRuns(
  workingDir: string,
  conversationId: string,
): Promise<number[]> {
  const forConversation = harnessDir(workingDir, conversationId);
  try {
    const entries = await fs.readdir(forConversation, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => Number(e.name))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** The run in play — the newest one, or none yet. */
export async function currentRunIndex(
  workingDir: string,
  conversationId: string,
): Promise<number | null> {
  const runs = await listRuns(workingDir, conversationId);
  return runs.length ? runs[runs.length - 1] : null;
}

/** The index a NEW goal should use. Never reuses a number. */
export async function nextRunIndex(
  workingDir: string,
  conversationId: string,
): Promise<number> {
  const current = await currentRunIndex(workingDir, conversationId);
  return current === null ? 1 : current + 1;
}

export async function readLedger(dir: string): Promise<LedgerResult<Ledger>> {
  const raw = await fsStore(dir).readText(LEDGER_FILE);
  // 'no ledger' verbatim: callers match on it, and a store returning null is
  // the same condition the old try/catch was catching.
  if (raw === null) return { ok: false, error: 'no ledger' };
  return parseLedger(raw);
}

export async function writeLedger(dir: string, ledger: Ledger): Promise<void> {
  await fsStore(dir).writeText(LEDGER_FILE, JSON.stringify(ledger, null, 2) + '\n');
}

export async function readGoal(dir: string): Promise<LedgerResult<Goal>> {
  const raw = await fsStore(dir).readText(GOAL_FILE);
  if (raw === null) return { ok: false, error: 'no goal' };
  return parseGoal(raw);
}

/**
 * Write the goal, once.
 *
 * Refuses to overwrite an existing goal. An agent that can rewrite the objective
 * does not have one, and the cheapest way to make that true is for the only
 * writer to refuse the second write.
 */
export async function writeGoalOnce(dir: string, goal: Goal): Promise<LedgerResult<void>> {
  const existing = await readGoal(dir);
  if (existing.ok) return { ok: false, error: 'goal already exists and may not be rewritten' };
  await fsStore(dir).writeText(GOAL_FILE, JSON.stringify(goal, null, 2) + '\n');
  return { ok: true, value: undefined };
}

/**
 * Append a session's summary.
 *
 * Append-only and prose, because this is what a human reads to close the gap
 * between what the loop built and what they understand — the thing the research
 * calls comprehension debt. A rewritten summary loses the history that makes it
 * worth reading.
 */
export async function appendProgress(dir: string, entry: string): Promise<void> {
  const file = path.join(dir, PROGRESS_FILE);
  await fs.mkdir(dir, { recursive: true });

  let exists = true;
  try {
    await fs.access(file);
  } catch {
    exists = false;
  }
  if (!exists) {
    await fs.writeFile(file, '# Progress\n\nAppend-only. Each entry is one session.\n', 'utf8');
  }

  // `appendFile`, not writeAtomic: rewriting the whole file to add a paragraph
  // would drop an entry written concurrently by another session.
  await fs.appendFile(file, `\n${entry.trim()}\n`, 'utf8');
}

/**
 * Keep the run's state out of the user's commits.
 *
 * We write into their working folder on purpose — the agent finds it with `Glob`
 * without being told, and it survives across conversations on the same project —
 * but that is not a reason to put it in their diff. Idempotent, and a no-op when
 * there is no `.gitignore` to amend.
 */
export async function ensureGitignored(workingDir: string): Promise<boolean> {
  const file = path.join(workingDir, '.gitignore');
  let existing: string;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    return false;
  }
  const entry = `${DATA_DIR_NAME}/`;
  const already = existing
    .split('\n')
    .map((l) => l.trim())
    .some((l) => l === entry || l === DATA_DIR_NAME);
  if (already) return false;
  const sep = existing.endsWith('\n') ? '' : '\n';
  await fs.appendFile(file, `${sep}\n# ${DATA_DIR_NAME} — local agent run state\n${entry}\n`, 'utf8');
  return true;
}
