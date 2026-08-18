import type { Goal, Ledger } from './ledger';
import { isComplete } from './ledger';

/**
 * When a goal run must stop, and why.
 *
 * WHY THIS IS ITS OWN MODULE. The cautionary tale in the research is a coding
 * agent that retried 240 times over three hours for $4,200 while "three
 * monitoring dashboards displayed the spend in real time. None of them had the
 * authority to stop it." Every condition here returns a decision the loop is
 * required to obey, and every one has a test that fails if it is removed. A stop
 * condition with no failing test is a dashboard.
 *
 * WHY A REASON AND NOT A BOOLEAN. "The run stopped" is not something a user can
 * act on. Whether it ran out of money, ran out of time, or has been going in
 * circles for six sessions are three different situations with three different
 * next steps, and the panel says which.
 */

export type StopReason =
  | 'complete'
  | 'budget'
  | 'deadline'
  | 'session-cap'
  | 'no-progress'
  | 'stuck-task'
  | 'user'
  /** Parked on a question. The only halt that resumes by answering. */
  | 'awaiting-answer'
  | 'error';

export interface StopDecision {
  stop: boolean;
  reason?: StopReason;
  /** One line, shown to the user. */
  detail?: string;
}

export const GO: StopDecision = { stop: false };

export interface RunState {
  sessions: number;
  spentUsd: number;
  startedAtMs: number;
  /** Consecutive sessions that moved no task's status. */
  idleSessions: number;
  lastStateHash: string | null;
  /** Set when the user presses stop. Checked first among the halting reasons. */
  cancelled?: boolean;
}

export interface StopPolicy {
  /** Consecutive no-progress sessions tolerated before halting. */
  idleLimit: number;
  /** Failed attempts on ONE task before it is called stuck. */
  attemptLimit: number;
}

export const DEFAULT_POLICY: StopPolicy = {
  /*
   * Three, not one. A single session that moves no status is ordinary — reading
   * the codebase, reproducing a bug and writing a failing test can all happen
   * without a task changing state. Three in a row is a loop.
   */
  idleLimit: 3,
  /*
   * Five attempts on one task. Past that the model is not converging and the
   * next attempt is the same attempt; the research's failure mode is precisely
   * an agent retrying into a wall while the meter runs.
   */
  attemptLimit: 5,
};

export interface StopInput {
  goal: Goal;
  ledger: Ledger;
  run: RunState;
  policy?: StopPolicy;
  /** Injected so tests are not at the mercy of the clock. */
  nowMs: number;
}

/**
 * Should the loop keep going?
 *
 * ORDER IS DELIBERATE. Success is checked before every limit, so a run that
 * finishes on its last dollar reports `complete` rather than `budget` — the user
 * should not be told they ran out of money when they got what they asked for.
 * The user's own cancel comes next, then hard resource limits, then the
 * behavioural ones.
 */
export function shouldStop(input: StopInput): StopDecision {
  const { goal, ledger, run, nowMs } = input;
  const policy = input.policy ?? DEFAULT_POLICY;

  if (isComplete(ledger)) {
    return { stop: true, reason: 'complete', detail: `All ${ledger.tasks.length} tasks passed.` };
  }

  if (run.cancelled) {
    return { stop: true, reason: 'user', detail: 'Stopped by you.' };
  }

  /*
   * `null` means no limit; `0` means zero.
   *
   * Not a pedantic distinction. The existing resume loop writes
   * `!effectiveBudgetUsd || spentUsd < effectiveBudgetUsd`, which treats a
   * budget of 0 as "unlimited" — the exact inversion of what a user setting it
   * to zero would mean. Here the absence of a limit and a limit of nothing are
   * different values and behave differently.
   */
  if (goal.budgetUsd !== null && run.spentUsd >= goal.budgetUsd) {
    return {
      stop: true,
      reason: 'budget',
      detail: `Spent $${run.spentUsd.toFixed(2)} of $${goal.budgetUsd.toFixed(2)}.`,
    };
  }

  if (goal.deadlineIso !== null) {
    const deadline = Date.parse(goal.deadlineIso);
    if (Number.isNaN(deadline)) {
      /*
       * A limit we cannot evaluate is NOT an absent limit.
       *
       * Treating an unparseable deadline as "no deadline" is how a control ends
       * up looking enforced while enforcing nothing — the shape this codebase
       * has shipped before with the security toggles. Refuse loudly instead.
       */
      return { stop: true, reason: 'error', detail: `Deadline "${goal.deadlineIso}" is not a date.` };
    }
    if (nowMs >= deadline) {
      return { stop: true, reason: 'deadline', detail: `Reached the deadline (${goal.deadlineIso}).` };
    }
  }

  if (goal.sessionCap !== null && run.sessions >= goal.sessionCap) {
    return { stop: true, reason: 'session-cap', detail: `Ran ${run.sessions} sessions.` };
  }

  if (run.idleSessions >= policy.idleLimit) {
    return {
      stop: true,
      reason: 'no-progress',
      detail: `${run.idleSessions} sessions in a row moved nothing. Needs a human.`,
    };
  }

  const stuck = ledger.tasks.find(
    (t) => t.status !== 'passed' && t.attempts >= policy.attemptLimit,
  );
  if (stuck) {
    return {
      stop: true,
      reason: 'stuck-task',
      detail: `"${stuck.title}" failed ${stuck.attempts} times.`,
    };
  }

  return GO;
}

/**
 * Fold a finished session into the run state.
 *
 * The idle counter is the no-progress detector's whole memory, and it keys on
 * the ledger's state hash — which covers `(id, status)` and deliberately not
 * `attempts`. A session that burned money and moved no task's status is idle
 * however busy it looked.
 */
export function recordSession(
  run: RunState,
  outcome: { costUsd: number; stateHash: string },
): RunState {
  const moved = run.lastStateHash !== null && outcome.stateHash !== run.lastStateHash;
  // The first session has nothing to compare against, so it is never idle — it
  // establishes the baseline.
  const firstSession = run.lastStateHash === null;
  return {
    ...run,
    sessions: run.sessions + 1,
    spentUsd: run.spentUsd + outcome.costUsd,
    idleSessions: moved || firstSession ? 0 : run.idleSessions + 1,
    lastStateHash: outcome.stateHash,
  };
}

export function newRunState(nowMs: number): RunState {
  return { sessions: 0, spentUsd: 0, startedAtMs: nowMs, idleSessions: 0, lastStateHash: null };
}

/** Did the run end in a way the user should look at? */
export function needsAttention(reason: StopReason | undefined): boolean {
  return (
    reason === 'no-progress' ||
    reason === 'stuck-task' ||
    reason === 'error' ||
    reason === 'awaiting-answer'
  );
}
