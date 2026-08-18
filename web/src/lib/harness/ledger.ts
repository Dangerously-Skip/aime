import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DATA_DIR_NAME } from '@/config/branding';

/**
 * Durable state for a long-running goal run.
 *
 * WHY FILES. A goal run spans many sessions, and each session starts with no
 * memory of the last one. Anything not written down is lost at the context
 * boundary — the failure mode the literature calls memory degradation, where a
 * long project quietly loses the details that made its early decisions correct.
 * So the loop carries almost nothing in context and reads its state back from
 * disk each session.
 *
 * WHY THE AGENT IS NOT TRUSTED WITH IT. The execution session has `Write` and
 * `Edit`, and these files sit in its working directory where it can reach them.
 * That is deliberate — it must be able to mark a task passed — but it means the
 * write restriction cannot be a sentence in a prompt. There are two enforcement
 * points here and they answer different threats:
 *
 *   - `applySessionUpdate` is the sanctioned path, and takes a patch shape that
 *     CANNOT EXPRESS an illegal change. Nothing to enforce, by construction.
 *   - `illegalChanges` compares what came back off disk against what we last
 *     wrote, and is how out-of-band tampering is caught — a session that edits
 *     the file directly, deletes a task it found hard, or rewords the acceptance
 *     steps so its work passes.
 *
 * The second is the one that matters. An agent optimising `status` rather than
 * the goal is reward hacking, and the only defence is that the thing being
 * optimised is checked by something the agent does not control.
 *
 * WHY JSON. Models are measurably less willing to overwrite a JSON file wholesale
 * than a Markdown one. `progress.md` is prose because a human reads it; the
 * ledger is JSON because a machine has to trust it.
 */

export type TaskStatus = 'todo' | 'doing' | 'passed' | 'blocked';

export interface TaskVerdict {
  passed: boolean;
  /** What the verifier found missing, verbatim — fed to the next attempt. */
  missing: string[];
  /** Commands run and what they returned. An assurance is not evidence. */
  evidence: string[];
  at: string;
}

export interface Task {
  /** Stable for the life of the run, and never reused once retired. */
  id: string;
  title: string;
  /** How a verifier decides this is done. Not editable by an execution session. */
  verify: string[];
  status: TaskStatus;
  attempts: number;
  lastVerdict: TaskVerdict | null;
}

export interface Ledger {
  version: 1;
  tasks: Task[];
  /**
   * Ids of tasks removed by an approved plan revision.
   *
   * Kept because a shrunk ledger cannot tell you the highest id it ever issued —
   * so numbering from what remains hands a new task the id of a retired one, and
   * ids key every patch, run record and verdict. Optional, so a ledger written
   * before this existed still parses.
   */
  retiredIds?: string[];
}

export interface Goal {
  version: 1;
  objective: string;
  acceptanceCriteria: string[];
  /** Stop conditions. Absent means "no limit of this kind", not "zero". */
  budgetUsd: number | null;
  deadlineIso: string | null;
  sessionCap: number | null;
  createdAt: string;
}

/** The only fields an execution session may move. */
export interface TaskPatch {
  id: string;
  status?: TaskStatus;
  attempts?: number;
  lastVerdict?: TaskVerdict | null;
}

export type LedgerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

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

export const GOAL_FILE = 'goal.json';
export const LEDGER_FILE = 'tasks.json';
export const PROGRESS_FILE = 'progress.md';

/**
 * Write via a temp file and rename.
 *
 * `rename` is atomic on POSIX, so a reader never sees a half-written ledger and
 * a crash mid-write leaves the previous state intact rather than a truncated
 * file. Writing in place would make "the app was killed during a session" a way
 * to lose every task's status.
 */
async function writeAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

function isTaskStatus(v: unknown): v is TaskStatus {
  return v === 'todo' || v === 'doing' || v === 'passed' || v === 'blocked';
}

function parseVerdict(v: unknown): TaskVerdict | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.passed !== 'boolean') return null;
  return {
    passed: o.passed,
    missing: Array.isArray(o.missing) ? o.missing.filter((x): x is string => typeof x === 'string') : [],
    evidence: Array.isArray(o.evidence) ? o.evidence.filter((x): x is string => typeof x === 'string') : [],
    at: typeof o.at === 'string' ? o.at : '',
  };
}

/**
 * Parse a ledger, refusing anything that is not one.
 *
 * A corrupt or truncated ledger must NOT degrade to an empty one. An empty
 * ledger reads as "no tasks", which the loop would interpret as "the goal is
 * complete" and stop — losing the run and reporting success. Failing loudly is
 * the only safe reading of a file we cannot parse.
 */
export function parseLedger(raw: string): LedgerResult<Ledger> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `ledger is not valid JSON: ${(e as Error).message}` };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'ledger is not an object' };
  const o = data as Record<string, unknown>;
  if (o.version !== 1) return { ok: false, error: `unsupported ledger version: ${String(o.version)}` };
  if (!Array.isArray(o.tasks)) return { ok: false, error: 'ledger has no tasks array' };

  const tasks: Task[] = [];
  const seen = new Set<string>();
  for (const [i, t] of o.tasks.entries()) {
    if (typeof t !== 'object' || t === null) return { ok: false, error: `task ${i} is not an object` };
    const r = t as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id === '') return { ok: false, error: `task ${i} has no id` };
    // Duplicate ids would make a patch ambiguous — it could hit either task.
    if (seen.has(r.id)) return { ok: false, error: `duplicate task id: ${r.id}` };
    seen.add(r.id);
    if (typeof r.title !== 'string') return { ok: false, error: `task ${r.id} has no title` };
    if (!isTaskStatus(r.status)) return { ok: false, error: `task ${r.id} has invalid status` };
    tasks.push({
      id: r.id,
      title: r.title,
      verify: Array.isArray(r.verify) ? r.verify.filter((x): x is string => typeof x === 'string') : [],
      status: r.status,
      attempts: typeof r.attempts === 'number' && r.attempts >= 0 ? r.attempts : 0,
      lastVerdict: parseVerdict(r.lastVerdict),
    });
  }
  const retiredIds = Array.isArray(o.retiredIds)
    ? o.retiredIds.filter((x): x is string => typeof x === 'string')
    : [];
  return { ok: true, value: { version: 1, tasks, ...(retiredIds.length ? { retiredIds } : {}) } };
}

export function parseGoal(raw: string): LedgerResult<Goal> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `goal is not valid JSON: ${(e as Error).message}` };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'goal is not an object' };
  const o = data as Record<string, unknown>;
  if (o.version !== 1) return { ok: false, error: `unsupported goal version: ${String(o.version)}` };
  if (typeof o.objective !== 'string' || o.objective.trim() === '') {
    return { ok: false, error: 'goal has no objective' };
  }
  return {
    ok: true,
    value: {
      version: 1,
      objective: o.objective,
      acceptanceCriteria: Array.isArray(o.acceptanceCriteria)
        ? o.acceptanceCriteria.filter((x): x is string => typeof x === 'string')
        : [],
      budgetUsd: typeof o.budgetUsd === 'number' ? o.budgetUsd : null,
      deadlineIso: typeof o.deadlineIso === 'string' ? o.deadlineIso : null,
      sessionCap: typeof o.sessionCap === 'number' ? o.sessionCap : null,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    },
  };
}

export async function readLedger(dir: string): Promise<LedgerResult<Ledger>> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, LEDGER_FILE), 'utf8');
  } catch {
    return { ok: false, error: 'no ledger' };
  }
  return parseLedger(raw);
}

export async function writeLedger(dir: string, ledger: Ledger): Promise<void> {
  await writeAtomic(path.join(dir, LEDGER_FILE), JSON.stringify(ledger, null, 2) + '\n');
}

export async function readGoal(dir: string): Promise<LedgerResult<Goal>> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, GOAL_FILE), 'utf8');
  } catch {
    return { ok: false, error: 'no goal' };
  }
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
  await writeAtomic(path.join(dir, GOAL_FILE), JSON.stringify(goal, null, 2) + '\n');
  return { ok: true, value: undefined };
}

/**
 * Apply the changes an execution session is allowed to make.
 *
 * The patch type is the enforcement: there is no field on it that could rename a
 * task, reword its verification steps, add one or drop one. A caller holding
 * only this function cannot corrupt the plan even if it tries.
 */
export function applySessionUpdate(
  ledger: Ledger,
  patches: TaskPatch[],
): LedgerResult<Ledger> {
  const byId = new Map(ledger.tasks.map((t) => [t.id, t]));
  for (const p of patches) {
    if (!byId.has(p.id)) return { ok: false, error: `unknown task id: ${p.id}` };
    if (p.attempts !== undefined && (!Number.isInteger(p.attempts) || p.attempts < 0)) {
      return { ok: false, error: `attempts must be a non-negative integer for ${p.id}` };
    }
  }
  const patched = new Map(patches.map((p) => [p.id, p]));
  return {
    ok: true,
    value: {
      version: 1,
      ...(ledger.retiredIds?.length ? { retiredIds: ledger.retiredIds } : {}),
      tasks: ledger.tasks.map((t) => {
        const p = patched.get(t.id);
        if (!p) return t;
        return {
          ...t,
          status: p.status ?? t.status,
          attempts: p.attempts ?? t.attempts,
          lastVerdict: p.lastVerdict !== undefined ? p.lastVerdict : t.lastVerdict,
        };
      }),
    },
  };
}

/**
 * What changed between the ledger we wrote and the one we just read back, that
 * a session was not entitled to change.
 *
 * This is the tamper check, and the reason it exists rather than trusting the
 * prompt: the working directory is writable and the session has `Write`. Removing
 * a task it could not finish, or softening `verify` until its work passes, are
 * both reward hacking and both invisible to a loop that simply re-reads the file.
 *
 * Returns human-readable descriptions because they go into the run record and,
 * if the loop halts, in front of the user.
 */
export function illegalChanges(before: Ledger, after: Ledger): string[] {
  const problems: string[] = [];
  const beforeById = new Map(before.tasks.map((t) => [t.id, t]));
  const afterById = new Map(after.tasks.map((t) => [t.id, t]));

  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) {
      // An approved revision records the id as retired; that is a plan change,
      // not a session quietly deleting work it found hard.
      if (!after.retiredIds?.includes(id)) {
        problems.push(`task ${id} ("${b.title}") was removed`);
      }
      continue;
    }
    if (a.title !== b.title) {
      problems.push(`task ${id} was retitled from "${b.title}" to "${a.title}"`);
    }
    if (a.verify.length !== b.verify.length || a.verify.some((v, i) => v !== b.verify[i])) {
      problems.push(`task ${id} had its verification steps changed`);
    }
  }
  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) problems.push(`task ${id} was added`);
  }
  return problems;
}

/**
 * A fingerprint of PROGRESS, for the no-progress stop condition.
 *
 * Deliberately only `(id, status)`. Attempts and verdicts move every time a
 * session runs, so including them would make an agent failing the same task
 * forty times look like forty units of progress — which is exactly the runaway
 * this hash exists to detect.
 */
export function ledgerStateHash(ledger: Ledger): string {
  const material = [...ledger.tasks]
    .map((t) => `${t.id}:${t.status}`)
    .sort()
    .join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** The next task to work, or null when there is nothing left to do. */
export function nextTask(ledger: Ledger): Task | null {
  // `doing` first: a task left mid-flight by an interrupted session is resumed
  // rather than abandoned next to a fresh one.
  return (
    ledger.tasks.find((t) => t.status === 'doing') ??
    ledger.tasks.find((t) => t.status === 'todo') ??
    null
  );
}

export function isComplete(ledger: Ledger): boolean {
  return ledger.tasks.length > 0 && ledger.tasks.every((t) => t.status === 'passed');
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
