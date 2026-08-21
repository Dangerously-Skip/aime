import { runGoalLoop, readRunState, type SessionRunner, type LoopEvent } from './goal-loop';
import { readGoal, readLedger, type Ledger, type Goal } from './ledger';
import { readQuestion, type ParkedQuestion } from './question';
import { newRunState, type RunState, type StopDecision, type StopPolicy } from './stop';

/**
 * Live goal runs, keyed by conversation.
 *
 * WHY THIS EXISTS AT ALL. Everything else in this app is request-scoped: a turn
 * begins when the renderer opens a stream and dies when it closes. A goal run is
 * the opposite — it has to outlive the request that started it, survive the user
 * switching surface or closing the window, and pick up again after a restart.
 * Driving it from the renderer would mean the run ends exactly when it becomes
 * most valuable.
 *
 * So the loop runs here, in the Next server process, and its authoritative state
 * is on disk. This registry is a CACHE of what is running now, not the source of
 * truth: `status()` falls back to reading the files, which is what makes a run
 * still legible after the process that started it is gone.
 *
 * Held on `globalThis` for the same reason the preview servers are — Next
 * re-evaluates modules on edit in dev, and module-level state would strand a
 * running loop with no handle to stop it.
 */
const KEY = Symbol.for('aime.harness.runs');

/**
 * The live pulse of a session, between loop events.
 *
 * ONE ROLLING RECORD, not an event per tool. A session can be a hundred tool
 * calls; pushing each into `events` would bury the session/verify/park entries
 * that actually mark progress, and hand the poller a hundred rows to render.
 * What the user needs is the answer to "is it alive, and doing what" — a name
 * and a count answer that in two fields.
 */
export interface Activity {
  /** Most recent tool name. */
  tool: string;
  /** Tool calls in this run so far. A number that moves IS the liveness signal. */
  count: number;
  /** Epoch ms of the last one, so the UI can say how long ago. */
  at: number;
}

interface LiveRun {
  dir: string;
  controller: AbortController;
  events: LoopEvent[];
  activity: Activity | null;
  run: RunState;
  finished: boolean;
  decision?: StopDecision;
  promise: Promise<void>;
}

type Registry = Map<string, LiveRun>;

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

/** How many events to keep per run for the panel. */
export const EVENT_BUFFER = 200;

export interface StartOptions {
  conversationId: string;
  dir: string;
  runSession: SessionRunner;
  /** The checker. Absent means passes are the session's own claim. */
  verify?: import('./verifier').Verifier;
  policy?: StopPolicy;
  now?: () => number;
  /**
   * Receives a reporter for this run's tool activity.
   *
   * Inverted like this because the session runner is built by the CALLER, before
   * `startRun` exists to report into. The caller holds a mutable slot, passes a
   * sink here, and points the slot at it — so the runner does not need to know
   * about the registry and the registry does not need to build session runners.
   */
  onActivitySink?: (report: (tool: string) => void) => void;
}

export type StartResult =
  | { ok: true }
  | { ok: false; error: string };

export function isRunning(conversationId: string): boolean {
  const r = registry().get(conversationId);
  return !!r && !r.finished;
}

/**
 * Start a run. Refuses if one is already going for this conversation.
 *
 * Two loops over one directory would interleave ledger writes and each would see
 * the other's work as tampering. The refusal is not a nicety.
 */
export function startRun(opts: StartOptions): StartResult {
  const reg = registry();
  if (isRunning(opts.conversationId)) {
    return { ok: false, error: 'a run is already in progress for this conversation' };
  }

  const controller = new AbortController();
  const live: LiveRun = {
    dir: opts.dir,
    controller,
    events: [],
    activity: null,
    run: newRunState(opts.now?.() ?? Date.now()),
    finished: false,
    promise: Promise.resolve(),
  };
  /*
   * Handed to the caller so the session runner can report tool activity into
   * this run's record. A getter rather than the object, because `startRun` is
   * called before the caller has anything to report into.
   */
  opts.onActivitySink?.((tool) => {
    live.activity = {
      tool,
      count: (live.activity?.count ?? 0) + 1,
      at: opts.now?.() ?? Date.now(),
    };
  });

  live.promise = runGoalLoop({
    dir: opts.dir,
    runSession: opts.runSession,
    verify: opts.verify,
    policy: opts.policy,
    now: opts.now,
    signal: controller.signal,
    onEvent: (e) => {
      live.events.push(e);
      if (live.events.length > EVENT_BUFFER) live.events.splice(0, live.events.length - EVENT_BUFFER);
      if (e.run) live.run = e.run;
    },
  })
    .then(({ decision, run }) => {
      live.decision = decision;
      live.run = run;
    })
    .catch((e: unknown) => {
      // A throw out of the loop is a bug, but it must not leave the registry
      // claiming the run is still going — that would block every later start.
      live.decision = {
        stop: true,
        reason: 'error',
        detail: e instanceof Error ? e.message : String(e),
      };
    })
    .finally(() => {
      live.finished = true;
    });

  reg.set(opts.conversationId, live);
  return { ok: true };
}

/** Ask a run to stop. Cooperative: the loop halts after the current session. */
export function stopRun(conversationId: string): boolean {
  const live = registry().get(conversationId);
  if (!live || live.finished) return false;
  live.controller.abort();
  return true;
}

export interface RunStatus {
  running: boolean;
  goal: Goal | null;
  ledger: Ledger | null;
  run: RunState | null;
  decision: StopDecision | null;
  events: LoopEvent[];
  /** Live tool pulse, or null when the run is not running. */
  activity: Activity | null;
  /** Set when the run is parked. The one halt a user can undo by answering. */
  question: ParkedQuestion | null;
  /** Which numbered run this is. Transcript keys need it to stay unique. */
  runIndex: number | null;
}

/**
 * What the panel renders.
 *
 * Reads the files rather than trusting the in-memory copy, so a run started
 * before the last restart still shows its goal, its ledger and where it got to.
 * The registry only supplies what disk cannot: whether it is running right now,
 * and the recent event stream.
 */
export async function runStatus(
  conversationId: string,
  dir: string,
  runIndex: number | null = null,
): Promise<RunStatus> {
  const live = registry().get(conversationId);
  const [goal, ledger, persisted, question] = await Promise.all([
    readGoal(dir),
    readLedger(dir),
    readRunState(dir),
    readQuestion(dir),
  ]);
  return {
    running: !!live && !live.finished,
    goal: goal.ok ? goal.value : null,
    ledger: ledger.ok ? ledger.value : null,
    run: live?.run ?? persisted,
    decision: live?.decision ?? null,
    events: live?.events ?? [],
    // Null once the run is over: a finished run has no pulse, and showing the
    // last tool it happened to call would read as still working.
    activity: live && !live.finished ? live.activity : null,
    question: question && question.answer === null ? question : null,
    runIndex,
  };
}

/** Await a run's completion. Tests use it; nothing in the app should. */
export async function awaitRun(conversationId: string): Promise<void> {
  await registry().get(conversationId)?.promise;
}

export function clearRuns(): void {
  registry().clear();
}
