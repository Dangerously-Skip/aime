/**
 * Goals and Runs — the substrate under both Clawish (P6/C1–C2) and Cockpit
 * (P6/K3).
 *
 * The insight that produced this file: OpenClaw's triggers, openworker's
 * outcomes, and a Cockpit dashboard all need the same missing object.
 *
 *   Goal   what outcome, how we know it's done, what may run unattended
 *    └─ Run          one execution: status, timing, cost, deliverables
 *        └─ Deliverable   the thing produced (file / artifact / widget / message)
 *
 * A standing order becomes a Goal with a schedule. A Cockpit widget becomes a
 * Goal whose deliverable is a widget node. A chat turn is an ad-hoc Run with no
 * Goal. Crucially, every Run is *recorded* — Burnbox's scheduled refreshes wrote
 * failures to stderr and discarded them, so a widget that had failed forty times
 * looked identical to one that had simply never run. We do not repeat that.
 */
import type { Capability, Tier } from '@/lib/models/types';

/** Why a run started. Mirrors OpenClaw's five input vectors. */
export type RunTrigger = 'manual' | 'chat' | 'cron' | 'heartbeat' | 'webhook' | 'hook';

export type RunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  /** Exceeded its time budget. Distinct from 'failed' — it may simply need longer. */
  | 'timeout'
  /** Waiting on a human for a consequential action (openworker's approval gate). */
  | 'awaiting_approval';

/** A run is finished when it will not change state again without a new trigger. */
export const TERMINAL_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
] as const;

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Something a run produced. The unit of "finished work" (openworker's framing). */
export interface Deliverable {
  kind: 'file' | 'artifact' | 'widget' | 'message';
  /** Filesystem path, for kind 'file'. */
  path?: string;
  title?: string;
  /** Short human summary — what a Cockpit tile shows without opening anything. */
  summary?: string;
  /** Structured payload, e.g. an A2UI node for kind 'widget'. */
  data?: unknown;
}

/**
 * Economics for one run. AIME already emits tokens/cost/duration on the `done`
 * SSE event, so attaching it here is what makes "what did my automation cost
 * and what did it produce" answerable — the thing none of OpenClaw, openworker,
 * or Burnbox can tell you.
 */
export interface RunCost {
  inputTokens: number;
  outputTokens: number;
  totalUsd: number;
}

export interface Run {
  id: string;
  /** Null for an ad-hoc run (e.g. a plain chat turn) with no owning Goal. */
  goalId: string | null;
  surfaceId?: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  cost?: RunCost;
  toolCalls?: number;
  /** Present when status is 'failed' or 'timeout'. User-facing, no stack traces. */
  error?: string;
  deliverables: Deliverable[];
  /** Result of checking the Goal's successCriteria, when it has any. */
  verification?: {
    passed: boolean;
    note?: string;
  };
  /** Which model actually ran, for cost attribution across providers. */
  model?: string;
}

/** When a Goal may act without asking first. */
export type ApprovalPolicy =
  /** Ask before every tool call with a side effect. */
  | 'always'
  /** Ask only before consequential actions (send, delete, spend, publish). */
  | 'consequential'
  /** Never ask — fully unattended. */
  | 'never';

export interface GoalSchedule {
  /** Cron expression, evaluated by the existing matchesCron(). */
  cron?: string;
  /** Simple interval alternative, in seconds. */
  everySeconds?: number;
}

export interface Goal {
  id: string;
  /** The desired outcome in the user's words — openworker's "declare the work". */
  objective: string;
  /**
   * How we know it worked. Free text, checked after the run. Absent ⇒ the run
   * is judged only on not erroring, which is weaker and should be surfaced.
   */
  successCriteria?: string;
  constraints?: string;
  approvalPolicy: ApprovalPolicy;
  schedule?: GoalSchedule;
  enabled: boolean;
  createdAt: number;
  /** Routing intent, resolved through the model registry at run time. */
  capability?: Capability;
  tier?: Tier;
  surfaceId?: string;
  lastRunAt?: number;
  /** Consecutive failures — drives escalation and "this is broken" in the UI. */
  consecutiveFailures?: number;
  /**
   * Aggregates from before run records existed — e.g. a standing order that had
   * already executed many times when it was adopted as a Goal. Kept separate
   * from live Run data because it is a count without detail: we know it ran, not
   * what happened. The UI shows it as context so a long-running order doesn't
   * read as "never run", but must not fold it into success rates it can't
   * substantiate.
   */
  prior?: {
    runCount: number;
    errorCount: number;
    totalUsd?: number;
  };
  /** Where this Goal came from, when it wasn't created directly. */
  sourceId?: string;
}

/** Aggregate health for a Goal, for a Cockpit tile or a scheduled-runs list. */
export interface RunSummary {
  total: number;
  succeeded: number;
  failed: number;
  /** Fraction 0..1 over terminal runs only, or null when none have finished. */
  successRate: number | null;
  totalUsd: number;
  /** Median duration over terminal runs, or null when none have finished. */
  medianDurationMs: number | null;
  lastRun?: Run;
  /** True when the most recent terminal run did not succeed. */
  currentlyFailing: boolean;
}
