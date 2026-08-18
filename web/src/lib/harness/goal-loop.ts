import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  readGoal,
  readLedger,
  writeLedger,
  applySessionUpdate,
  illegalChanges,
  ledgerStateHash,
  nextTask,
  appendProgress,
  type Goal,
  type Task,
  type TaskVerdict,
} from './ledger';
import type { Verifier } from './verifier';
import { parkQuestion, isWaiting, consumeAnswer } from './question';
import {
  shouldStop,
  recordSession,
  newRunState,
  type RunState,
  type StopDecision,
  type StopPolicy,
} from './stop';

/**
 * The outer loop: run sessions against a goal until it is done or must stop.
 *
 * WHAT IT REPLACES. Between runs, a human checks the output and decides what is
 * next. This automates the deciding. It does NOT yet automate the checking —
 * that is the verifier, in phase 2 — and until then a task is marked passed on
 * the session's own say-so. That is recorded honestly: `lastVerdict` stays null
 * and the run record carries `verified: false`, because "nothing checked this"
 * is a fact the user is entitled to.
 *
 * WHY THE SESSION RUNNER IS INJECTED. The model call is the only part of this
 * that cannot run in a test. Everything that decides whether the loop is correct
 * — the ledger, the tamper check, the stop conditions, the idle counter — is
 * real in `goal-loop.test.ts`. Mocking the loop's own logic would leave the
 * tests asserting on the mock.
 */

export interface SessionInput {
  goal: Goal;
  /** The ONE task this session works. Never a list. */
  task: Task;
  dir: string;
  sessionIndex: number;
  /** Verifier feedback from the last failed attempt, verbatim. */
  missing: string[];
  /** The user's answer to a question this run parked on, if there was one. */
  answer?: string | null;
}

export interface SessionOutcome {
  costUsd: number;
  /** One paragraph for progress.md. */
  summary: string;
  /**
   * Whether the session believes the task is done.
   *
   * Phase 1 takes this at face value. Phase 2 puts a verifier in front of it,
   * which is the whole reason this is named as a CLAIM rather than a result:
   * "the agent said so" and "it works" are different propositions, and this repo
   * has already shipped the gap between them — a deck agent reporting nine
   * embedded videos when every one was broken.
   */
  claimsComplete: boolean;
  /**
   * A decision only the user can make.
   *
   * Distinct from "not complete": retrying an unfinished task is how work gets
   * done, and retrying a question is how a loop burns a budget learning nothing.
   */
  question?: string | null;
  error?: string;
}

export type SessionRunner = (input: SessionInput) => Promise<SessionOutcome>;

export interface LoopEvent {
  type:
    | 'session-start'
    | 'session-end'
    | 'verify-start'
    | 'verify-end'
    | 'parked'
    | 'resumed'
    | 'tamper'
    | 'stopped';
  sessionIndex?: number;
  taskId?: string;
  detail?: string;
  run?: RunState;
}

export interface GoalLoopOptions {
  dir: string;
  runSession: SessionRunner;
  policy?: StopPolicy;
  /** Injected clock, so a deadline test does not have to wait for one. */
  now?: () => number;
  onEvent?: (e: LoopEvent) => void;
  /** Cooperative cancellation — the user's stop button, or app shutdown. */
  signal?: AbortSignal;
  /** Resume an interrupted run rather than starting a fresh one. */
  initialRun?: RunState;
  /**
   * The checker half of maker-checker.
   *
   * Optional so the loop still runs without one, but its absence is recorded:
   * an unverified pass is a claim, and the run record and the panel both say so.
   */
  verify?: Verifier;
}

export interface LoopResult {
  decision: StopDecision;
  run: RunState;
}

const STATE_FILE = 'state.json';

export async function readRunState(dir: string): Promise<RunState | null> {
  try {
    const raw = await fs.readFile(path.join(dir, STATE_FILE), 'utf8');
    const o = JSON.parse(raw) as Partial<RunState>;
    if (typeof o.sessions !== 'number' || typeof o.spentUsd !== 'number') return null;
    return {
      sessions: o.sessions,
      spentUsd: o.spentUsd,
      startedAtMs: typeof o.startedAtMs === 'number' ? o.startedAtMs : 0,
      idleSessions: typeof o.idleSessions === 'number' ? o.idleSessions : 0,
      lastStateHash: typeof o.lastStateHash === 'string' ? o.lastStateHash : null,
      cancelled: o.cancelled === true,
    };
  } catch {
    return null;
  }
}

async function writeRunState(dir: string, run: RunState): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, STATE_FILE), JSON.stringify(run, null, 2) + '\n', 'utf8');
}

async function writeRunRecord(dir: string, index: number, record: unknown): Promise<void> {
  const runs = path.join(dir, 'runs');
  await fs.mkdir(runs, { recursive: true });
  await fs.writeFile(
    path.join(runs, `${String(index).padStart(4, '0')}.json`),
    JSON.stringify(record, null, 2) + '\n',
    'utf8',
  );
}

export async function runGoalLoop(opts: GoalLoopOptions): Promise<LoopResult> {
  const { dir, runSession } = opts;
  const now = opts.now ?? (() => Date.now());
  const emit = (e: LoopEvent) => opts.onEvent?.(e);

  const goalRead = await readGoal(dir);
  if (!goalRead.ok) {
    return {
      decision: { stop: true, reason: 'error', detail: `Cannot read the goal: ${goalRead.error}` },
      run: opts.initialRun ?? newRunState(now()),
    };
  }
  const goal = goalRead.value;

  let run = opts.initialRun ?? (await readRunState(dir)) ?? newRunState(now());

  for (;;) {
    const ledgerRead = await readLedger(dir);
    if (!ledgerRead.ok) {
      /*
       * A ledger we cannot parse halts the run.
       *
       * `readLedger` refuses rather than returning an empty ledger for exactly
       * this reason: an empty one would read as "every task passed" and the loop
       * would report success on a truncated file.
       */
      const decision: StopDecision = {
        stop: true,
        reason: 'error',
        detail: `Cannot read the ledger: ${ledgerRead.error}`,
      };
      emit({ type: 'stopped', detail: decision.detail, run });
      return { decision, run };
    }
    let ledger = ledgerRead.value;

    if (opts.signal?.aborted) run = { ...run, cancelled: true };

    /*
     * A question outranks everything except the user's own stop.
     *
     * Checked before `shouldStop` so a parked run reports what it is waiting FOR
     * rather than the next limit it happens to trip. Unlike every other halt,
     * this one is resumable by answering — nothing about it is on a timer, so it
     * survives a night, a restart, and a week.
     */
    if (!run.cancelled && (await isWaiting(dir))) {
      const waiting: StopDecision = {
        stop: true,
        reason: 'awaiting-answer',
        detail: 'Waiting on your answer before it can continue.',
      };
      await writeRunState(dir, run);
      emit({ type: 'parked', detail: waiting.detail, run });
      return { decision: waiting, run };
    }

    // An answer that arrived is consumed exactly once, and reaches the session
    // as context rather than being silently dropped.
    const answered = await consumeAnswer(dir);
    if (answered) emit({ type: 'resumed', taskId: answered.taskId ?? undefined, detail: answered.answer ?? '' });

    const decision = shouldStop({ goal, ledger, run, policy: opts.policy, nowMs: now() });
    if (decision.stop) {
      await writeRunState(dir, run);
      emit({ type: 'stopped', detail: decision.detail, run });
      return { decision, run };
    }

    const task = nextTask(ledger);
    if (!task) {
      /*
       * Nothing runnable, but `shouldStop` did not call it complete — so every
       * remaining task is blocked. That is a human's problem, not another
       * session's.
       */
      const blocked: StopDecision = {
        stop: true,
        reason: 'stuck-task',
        detail: 'Every remaining task is blocked.',
      };
      await writeRunState(dir, run);
      emit({ type: 'stopped', detail: blocked.detail, run });
      return { decision: blocked, run };
    }

    const sessionIndex = run.sessions + 1;
    emit({ type: 'session-start', sessionIndex, taskId: task.id });

    // Mark it in flight BEFORE running, so a crash mid-session leaves a `doing`
    // task that the next run resumes rather than a `todo` one it may duplicate.
    const marked = applySessionUpdate(ledger, [{ id: task.id, status: 'doing' }]);
    if (marked.ok) {
      ledger = marked.value;
      await writeLedger(dir, ledger);
    }
    const beforeSession = ledger;

    let outcome: SessionOutcome;
    try {
      outcome = await runSession({
        goal,
        task,
        dir,
        sessionIndex,
        missing: task.lastVerdict?.missing ?? [],
        answer: answered?.answer ?? null,
      });
    } catch (e) {
      outcome = {
        costUsd: 0,
        summary: `Session ${sessionIndex} threw: ${(e as Error).message}`,
        claimsComplete: false,
        error: (e as Error).message,
      };
    }

    /*
     * Re-read from disk, because the session could have written it.
     *
     * The execution session has `Write` and the ledger is in its working
     * directory. That is deliberate — it has to mark its own task — but it means
     * what is on disk now is not necessarily what we wrote, and the difference
     * is where reward hacking lives.
     */
    const afterRead = await readLedger(dir);
    let tampered: string[] = [];
    if (afterRead.ok) {
      tampered = illegalChanges(beforeSession, afterRead.value);
      if (tampered.length > 0) {
        // Restore ours. A session does not get to rewrite the plan by editing a
        // file, and the loop must not carry the edited version forward.
        emit({ type: 'tamper', sessionIndex, taskId: task.id, detail: tampered.join('; ') });
        ledger = beforeSession;
        await writeLedger(dir, ledger);
      } else {
        ledger = afterRead.value;
      }
    } else {
      // Unparseable after the session — restore the last good one and let the
      // next iteration's read decide whether to halt.
      ledger = beforeSession;
      await writeLedger(dir, ledger);
    }

    /*
     * A session that ASKED did not fail — it stopped for a reason retrying
     * cannot resolve. Parking here, before the attempt counter moves, keeps a
     * question from burning through the stuck-task limit.
     */
    if (outcome.question) {
      const parked = await parkQuestion(dir, {
        taskId: task.id,
        question: outcome.question,
        context: outcome.summary.slice(-500),
      });
      if (parked.ok) {
        await appendProgress(
          dir,
          `## Session ${sessionIndex} — ${task.id} asked a question\n\n${outcome.question}`,
        );
        run = recordSession(run, { costUsd: outcome.costUsd, stateHash: ledgerStateHash(ledger) });
        await writeRunState(dir, run);
        const waiting: StopDecision = {
          stop: true,
          reason: 'awaiting-answer',
          detail: outcome.question,
        };
        emit({ type: 'parked', sessionIndex, taskId: task.id, detail: outcome.question, run });
        return { decision: waiting, run };
      }
    }

    const claimed = outcome.claimsComplete && !outcome.error && tampered.length === 0;

    /*
     * The session's claim is not the verdict.
     *
     * Verification runs only when the session claims completion — checking work
     * nobody says is finished costs a session to learn what we were already
     * told. A verdict that fails carries its `missing` list into the next
     * attempt verbatim, which is what stops the loop repeating the same failure
     * in different words.
     */
    let verdict: TaskVerdict | null = null;
    if (claimed && opts.verify) {
      emit({ type: 'verify-start', sessionIndex, taskId: task.id });
      try {
        verdict = await opts.verify(goal, task, outcome.summary);
      } catch (e) {
        verdict = {
          passed: false,
          missing: [`The verifier failed to run: ${(e as Error).message}`],
          evidence: [],
          at: new Date(0).toISOString(),
        };
      }
      emit({
        type: 'verify-end',
        sessionIndex,
        taskId: task.id,
        detail: verdict.passed ? 'passed' : verdict.missing[0],
      });
    }

    const succeeded = opts.verify ? claimed && verdict?.passed === true : claimed;
    const applied = applySessionUpdate(ledger, [
      {
        id: task.id,
        status: succeeded ? 'passed' : 'todo',
        attempts: task.attempts + 1,
        lastVerdict: verdict,
      },
    ]);
    if (applied.ok) {
      ledger = applied.value;
      await writeLedger(dir, ledger);
    }

    run = recordSession(run, { costUsd: outcome.costUsd, stateHash: ledgerStateHash(ledger) });
    await writeRunState(dir, run);

    await appendProgress(
      dir,
      [
        `## Session ${sessionIndex} — ${task.id} ${task.title}`,
        outcome.summary.trim(),
        tampered.length ? `**Rejected plan edits:** ${tampered.join('; ')}` : '',
        outcome.error ? `**Error:** ${outcome.error}` : '',
        verdict && !verdict.passed ? `**Verifier rejected it:** ${verdict.missing.join('; ')}` : '',
        `_Cost $${outcome.costUsd.toFixed(4)} · status ${
          succeeded ? (verdict ? 'passed (verified)' : 'passed (unverified)') : 'not done'
        }_`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );

    await writeRunRecord(dir, sessionIndex, {
      sessionIndex,
      taskId: task.id,
      costUsd: outcome.costUsd,
      claimsComplete: outcome.claimsComplete,
      // Whether anything CHECKED the claim, which is the difference between
      // "it works" and "the agent said so".
      verified: verdict !== null,
      verdict,
      tampered,
      error: outcome.error ?? null,
      stateHash: ledgerStateHash(ledger),
    });

    emit({ type: 'session-end', sessionIndex, taskId: task.id, run });
  }
}
