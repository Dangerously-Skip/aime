import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * A question the run needs answered before it can continue.
 *
 * WHY NOT `pending-questions.ts`. That bridge already parks an `AskUserQuestion`
 * and already distinguishes "expired" from "declined", which is the hard part of
 * a human gate — and its semantics are exactly wrong here. It gives the user
 * FIVE MINUTES and treats silence as a refusal. That is right for an interactive
 * turn, where someone is watching a stream and a stale prompt is worse than no
 * prompt. It is wrong for a run that continues while its owner is asleep: the
 * question would expire unanswered, the task would fail for a reason that was
 * never really a reason, and the run would grind to a halt on a timeout nobody
 * saw.
 *
 * So this one PARKS. It is written to disk, the loop stops with a reason that
 * says why, and it waits — through an app restart, through a week — until
 * someone answers. Nothing about it is on a timer.
 *
 * ONE AT A TIME, by construction. Parking halts the loop, so a second question
 * cannot arise while the first is open. `parkQuestion` refuses to overwrite an
 * unanswered one rather than silently replacing the thing the user is looking at.
 */

export interface ParkedQuestion {
  id: string;
  /** The task that raised it, if it came from a task rather than the run. */
  taskId: string | null;
  question: string;
  /** Suggested answers. Free text is always allowed; these are a shortcut. */
  options: string[];
  /** Why the loop could not decide this itself — shown with the question. */
  context: string;
  askedAt: string;
  answer: string | null;
  answeredAt: string | null;
  /** The plan change this question is gating, if it is gating one. */
  revision?: unknown;
}

export const QUESTION_FILE = 'question.json';

/**
 * Decisions the user has made, kept after the question is consumed.
 *
 * `consumeAnswer` deletes the question so a session cannot act on a decision
 * twice — which also deleted the only record that the decision existed. The
 * VERIFIER then had no way to see it: it reads the working tree and runs
 * commands, and an answer that lives only in one session's prompt is invisible
 * to it. So it twice rejected a correctly finished task with "the conversation
 * does not contain an unambiguous user answer", which was scepticism doing its
 * job against evidence it had not been shown. Two wasted sessions, about half
 * the run's cost.
 */
export const DECISIONS_FILE = 'decisions.json';

export interface Decision {
  question: string;
  answer: string;
  taskId: string | null;
  at: string;
}

export async function readDecisions(dir: string): Promise<Decision[]> {
  try {
    const raw = await fs.readFile(path.join(dir, DECISIONS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is Decision =>
        typeof d === 'object' && d !== null &&
        typeof (d as Decision).question === 'string' &&
        typeof (d as Decision).answer === 'string',
    );
  } catch {
    return [];
  }
}

/** Append-only: a decision is a fact about the run, not a mutable field. */
export async function recordDecision(dir: string, q: ParkedQuestion): Promise<void> {
  if (!q.answer) return;
  const all = await readDecisions(dir);
  all.push({ question: q.question, answer: q.answer, taskId: q.taskId, at: q.answeredAt ?? '' });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, DECISIONS_FILE), JSON.stringify(all, null, 2) + '\n', 'utf8');
}

function file(dir: string): string {
  return path.join(dir, QUESTION_FILE);
}

export async function readQuestion(dir: string): Promise<ParkedQuestion | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file(dir), 'utf8');
  } catch {
    return null;
  }
  try {
    const o = JSON.parse(raw) as Partial<ParkedQuestion>;
    if (typeof o.id !== 'string' || typeof o.question !== 'string' || !o.question.trim()) return null;
    return {
      id: o.id,
      taskId: typeof o.taskId === 'string' ? o.taskId : null,
      question: o.question,
      options: Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === 'string') : [],
      context: typeof o.context === 'string' ? o.context : '',
      askedAt: typeof o.askedAt === 'string' ? o.askedAt : '',
      answer: typeof o.answer === 'string' ? o.answer : null,
      answeredAt: typeof o.answeredAt === 'string' ? o.answeredAt : null,
      revision: o.revision,
    };
  } catch {
    // A corrupt question file must not read as "no question" — that would
    // silently resume a run that is waiting on a decision.
    return {
      id: 'unreadable',
      taskId: null,
      question: 'A question was saved but could not be read. Answer to continue, or stop the run.',
      options: [],
      context: '',
      askedAt: '',
      answer: null,
      answeredAt: null,
    };
  }
}

/** Is the run waiting on someone? */
export async function isWaiting(dir: string): Promise<boolean> {
  const q = await readQuestion(dir);
  return !!q && q.answer === null;
}

export interface ParkInput {
  taskId?: string | null;
  /**
   * A plan change waiting on this answer.
   *
   * Stored WITH the question so the decision and the thing it decides cannot
   * drift apart across a restart — approving on resume has to apply the same
   * revision the user was shown, not one reconstructed later.
   */
  revision?: unknown;
  question: string;
  options?: string[];
  context?: string;
  nowIso?: () => string;
}

export type ParkResult =
  | { ok: true; question: ParkedQuestion }
  | { ok: false; error: string };

export async function parkQuestion(dir: string, input: ParkInput): Promise<ParkResult> {
  if (!input.question.trim()) return { ok: false, error: 'a question needs to say something' };

  const existing = await readQuestion(dir);
  if (existing && existing.answer === null) {
    // Replacing an unanswered question would swap out the thing the user is
    // currently reading, and lose whatever the run was waiting on.
    return { ok: false, error: 'a question is already waiting to be answered' };
  }

  const q: ParkedQuestion = {
    id: randomBytes(8).toString('hex'),
    taskId: input.taskId ?? null,
    question: input.question.trim(),
    options: (input.options ?? []).filter((o) => o.trim() !== ''),
    context: (input.context ?? '').trim(),
    askedAt: (input.nowIso ?? (() => new Date().toISOString()))(),
    answer: null,
    answeredAt: null,
    ...(input.revision !== undefined ? { revision: input.revision } : {}),
  };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file(dir), JSON.stringify(q, null, 2) + '\n', 'utf8');
  return { ok: true, question: q };
}

export async function answerQuestion(
  dir: string,
  id: string,
  answer: string,
  nowIso: () => string = () => new Date().toISOString(),
): Promise<ParkResult> {
  const q = await readQuestion(dir);
  if (!q) return { ok: false, error: 'there is no question waiting' };
  /*
   * The id has to match. Two things make a stale answer possible: a panel left
   * open on an old question, and a restart between asking and answering. Neither
   * should be able to answer a question the user never saw.
   */
  if (q.id !== id) return { ok: false, error: 'that answer is for a different question' };
  if (q.answer !== null) return { ok: false, error: 'that question has already been answered' };
  if (!answer.trim()) return { ok: false, error: 'an empty answer is not an answer' };

  const answered: ParkedQuestion = { ...q, answer: answer.trim(), answeredAt: nowIso() };
  await fs.writeFile(file(dir), JSON.stringify(answered, null, 2) + '\n', 'utf8');
  return { ok: true, question: answered };
}

/**
 * Take the answer and clear the slot.
 *
 * Called by the loop when it resumes, so the answer is consumed exactly once —
 * leaving it in place would make the next session read a decision that had
 * already been acted on.
 */
/** Did the user say yes? Anything else — including silence — is no. */
export function isApproval(answer: string | null): boolean {
  return !!answer && /^\s*(allow|yes|ok(ay)?|approve[d]?|go ahead)\b/i.test(answer);
}

export async function consumeAnswer(dir: string): Promise<ParkedQuestion | null> {
  const q = await readQuestion(dir);
  if (!q || q.answer === null) return null;
  // Kept before the question is destroyed — the decision outlives the asking.
  await recordDecision(dir, q);
  await fs.rm(file(dir), { force: true });
  return q;
}
