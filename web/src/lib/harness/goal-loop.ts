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
import { parkQuestion, isWaiting, consumeAnswer, isApproval, readDecisions } from './question';
import { classifyRevision, applyRevision } from './revision';
import { QUESTION_MARKER } from './session';
import { REVISION_MARKER } from './revision';

/** Everything before the protocol markers — the part written for a human. */
function stripMarker(text: string): string {
  let out = text;
  for (const marker of [QUESTION_MARKER, REVISION_MARKER]) {
    const at = out.indexOf(marker);
    if (at !== -1) out = out.slice(0, at);
  }
  return out.trim();
}
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
  /** Clickable alternatives the session offered with its question. */
  questionOptions?: string[];
  /** A proposed change to the plan, if the session found the plan wrong. */
  revision?: import('./revision').Revision | null;
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
    | 'revised'
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

/**
 * How many times one run may change its own plan.
 *
 * Found by a test rather than by reasoning. A session that proposes an addition
 * every time never trips the no-progress detector, because the idle counter keys
 * on the ledger's state hash and adding a task CHANGES it. So "keep adding work"
 * is a way to look busy forever — the run only stops when it runs out of money.
 *
 * Six is loose enough that honest re-planning is never blocked and tight enough
 * that a loop cannot hide behind it.
 */
export const MAX_REVISIONS = 6;

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
      revisions: typeof o.revisions === 'number' ? o.revisions : 0,
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
  // Per RUN, not per loop invocation: a loop-local counter resets on every park
  // or restart, so a run could revise indefinitely by pausing between edits.
  let revisions = run.revisions ?? 0;

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
    if (answered) {
      /*
       * An approved plan change is applied HERE, on resume.
       *
       * Without this the "Allow" button did nothing: the answer was recorded and
       * the removal never happened, so the run carried on with the task the user
       * had just agreed to drop.
       */
      if (answered.revision && isApproval(answered.answer)) {
        const fresh = await readLedger(dir);
        if (fresh.ok) {
          const applied = applyRevision(
            fresh.value,
            answered.revision as import('./revision').Revision,
            true,
          );
          await writeLedger(dir, applied);
          /*
           * And to the copy this iteration is holding.
           *
           * The ledger was read at the top of the loop, before the answer was
           * consumed. Writing the revision to disk without updating `ledger`
           * meant the next `applySessionUpdate` wrote the stale one straight
           * back over it — the removal happened and was immediately undone.
           */
          ledger = applied;
          emit({ type: 'revised', taskId: answered.taskId ?? undefined, detail: 'Plan change approved.' });
        }
      }
      /*
       * A task that exists to ASK is finished by the answer.
       *
       * You were asked twice. The planner made "Ask the user whether to compute
       * gross or net" a task of its own — reasonably — but no amount of further
       * work can complete it, so the resumed session read the answer as context,
       * found the task still open, and asked again. It would have asked until
       * the attempt limit killed it.
       *
       * The answer IS the deliverable, and it is recorded as the evidence.
       */
      if (answered.taskId && !answered.revision) {
        const fresh = await readLedger(dir);
        if (fresh.ok) {
          const resolved = applySessionUpdate(fresh.value, [
            {
              id: answered.taskId,
              status: 'passed',
              lastVerdict: {
                passed: true,
                missing: [],
                evidence: [`Answered by the user: "${answered.answer}"`],
                at: new Date(0).toISOString(),
              },
            },
          ]);
          if (resolved.ok) {
            ledger = resolved.value;
            await writeLedger(dir, ledger);
            emit({
              type: 'verify-end',
              taskId: answered.taskId,
              detail: 'passed',
            });
          }
        }
      }
      emit({ type: 'resumed', taskId: answered.taskId ?? undefined, detail: answered.answer ?? '' });
    }

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
        /*
         * EVERY decision, not only the one just consumed. A session that starts
         * two tasks later still needs to know which total the user chose.
         */
        answer:
          (await readDecisions(dir))
            .map((d) => `${d.question} → ${d.answer}`)
            .join('\n') || null,
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
     * The plan changed.
     *
     * Additions land immediately — discovering more work is honest and can only
     * make the run longer. Removals stop the run and ask, because dropping work
     * shrinks what "done" means, which is exactly the move reward hacking makes.
     */
    let revisionNote = '';
    if (outcome.revision && revisions >= MAX_REVISIONS) {
      revisionNote = `Refused plan change: this run has already revised its plan ${revisions} times.`;
      emit({ type: 'revised', sessionIndex, taskId: task.id, detail: revisionNote });
    } else if (outcome.revision) {
      const classified = classifyRevision(ledger, outcome.revision);
      if (classified.kind === 'auto') {
        ledger = applyRevision(ledger, outcome.revision, false);
        await writeLedger(dir, ledger);
        revisions++;
        run = { ...run, revisions };
        revisionNote = `Added ${outcome.revision.add.length} task(s): ${outcome.revision.reason}`;
        emit({ type: 'revised', sessionIndex, taskId: task.id, detail: revisionNote });
      } else if (classified.kind === 'needs-approval') {
        // Additions in the same proposal still land; only the removals wait.
        if (outcome.revision.add.length > 0) {
          ledger = applyRevision(ledger, { ...outcome.revision, remove: [] }, false);
          await writeLedger(dir, ledger);
        }
        const parked = await parkQuestion(dir, {
          taskId: task.id,
          question: classified.approvalPrompt ?? 'The run wants to change the plan. Allow it?',
          options: ['Allow', 'Keep the plan as it is'],
          context: classified.refusals.join(' '),
          // Stored WITH the question so approving on resume applies the change
          // the user was actually shown.
          revision: outcome.revision,
        });
        if (parked.ok) {
          await appendProgress(dir, `## Session ${sessionIndex} — proposed a plan change\n\n${classified.approvalPrompt}`);
          run = recordSession(run, { costUsd: outcome.costUsd, stateHash: ledgerStateHash(ledger) });
          await writeRunState(dir, run);
          const waiting: StopDecision = { stop: true, reason: 'awaiting-answer', detail: classified.approvalPrompt };
          emit({ type: 'parked', sessionIndex, taskId: task.id, detail: classified.approvalPrompt, run });
          return { decision: waiting, run };
        }
      } else if (classified.refusals.length > 0) {
        revisionNote = `Refused plan change: ${classified.refusals.join(' ')}`;
        emit({ type: 'revised', sessionIndex, taskId: task.id, detail: revisionNote });
      }
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
        options: outcome.questionOptions ?? [],
        /*
         * The summary UP TO the marker.
         *
         * Slicing the tail dragged the raw protocol into the user's face:
         * "…STATUS: QUESTION Which total should I compute? || gross | net".
         * The syntax is how the session talks to the loop; it is not something
         * to show someone being asked a question.
         */
        context: stripMarker(outcome.summary).slice(-400),
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

    /*
     * An INFRASTRUCTURE failure is not a failed attempt.
     *
     * Six sessions died on "Not logged in · Please run /login" and each one
     * counted against the task, so the stuck-task limit killed a run that had
     * never actually tried. Attempts measure whether the WORK is converging;
     * a session that could not start has said nothing about that.
     */
    const infrastructureFailure =
      !!outcome.error && /not logged in|no api key|unauthor|401|invalid api key/i.test(outcome.error);
    if (infrastructureFailure) {
      await appendProgress(
        dir,
        `## Session ${sessionIndex} — ${task.id} could not start\n\n${outcome.error}\n\n` +
          `_Not counted as an attempt._`,
      );
      run = recordSession(run, { costUsd: outcome.costUsd, stateHash: ledgerStateHash(ledger) });
      await writeRunState(dir, run);
      const halted: StopDecision = {
        stop: true,
        reason: 'error',
        detail: `The run could not reach the model: ${outcome.error}`,
      };
      emit({ type: 'stopped', sessionIndex, taskId: task.id, detail: halted.detail, run });
      return { decision: halted, run };
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
        verdict = await opts.verify(goal, task, outcome.summary, await readDecisions(dir));
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
        /*
         * Only when there IS one. Writing `null` over a stored rejection loses
         * the verifier's `missing` list, which is exactly what the next attempt
         * is supposed to read — so an unverified session would silently erase
         * the reason the last one failed.
         */
        ...(verdict ? { lastVerdict: verdict } : {}),
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
        revisionNote ? `**Plan:** ${revisionNote}` : '',
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
