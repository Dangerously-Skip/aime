/**
 * Verification and retry — C4.
 *
 * The gap this closes: until now every run was judged only on "didn't throw".
 * openworker has the same weakness — its approval gate is its *only*
 * accountability mechanism, with no check that the declared outcome actually
 * happened. So a run that completes cheerfully having achieved nothing is
 * recorded as a success.
 *
 * A Goal with `successCriteria` gets a second, cheap judgement pass: did the
 * work meet the criteria? That produces the distinction that matters —
 *
 *   status: 'succeeded' + verification.passed === false
 *     → "it ran fine and did not do the job"
 *
 * which is invisible in every reference tool we looked at, and is exactly what a
 * user needs to know about unattended work.
 *
 * Pure: no I/O, no clock, no model calls. The route supplies those.
 */
import { TIER_ORDER, type Tier } from '@/lib/models/types';
import type { Goal, Run } from './types';

/** Does this goal state criteria worth checking? */
export function needsVerification(goal: Pick<Goal, 'successCriteria'>): boolean {
  return Boolean(goal.successCriteria?.trim());
}

export interface Verdict {
  passed: boolean;
  /** One short sentence. Shown to the user, so no stack traces or IDs. */
  note?: string;
}

/**
 * Prompt for the judging pass. Deliberately biased toward "not met": an
 * unverifiable run should read as unverified rather than quietly passing, or the
 * check is decoration. This mirrors the adversarial-verify discipline — the
 * judge's job is to find the gap, not to be agreeable.
 */
export function buildVerificationPrompt(goal: Goal, run: Run, outputSummary: string): string {
  const deliverables = run.deliverables.length
    ? run.deliverables
        .map((d) => `- ${d.kind}${d.title ? `: ${d.title}` : ''}${d.summary ? ` — ${d.summary}` : ''}${d.path ? ` (${d.path})` : ''}`)
        .join('\n')
    : '(none)';

  return [
    'You are checking whether a completed piece of automated work met its stated criteria.',
    '',
    `OBJECTIVE:\n${goal.objective}`,
    '',
    `SUCCESS CRITERIA:\n${goal.successCriteria}`,
    '',
    `WHAT THE RUN PRODUCED:\n${outputSummary || '(no output captured)'}`,
    '',
    `DELIVERABLES:\n${deliverables}`,
    '',
    run.error ? `THE RUN REPORTED AN ERROR:\n${run.error}\n` : '',
    'Decide strictly. If you cannot confirm from the evidence above that the',
    'criteria were met, answer "no" — an unconfirmed result is NOT a pass.',
    'Do not give credit for intent, effort, or a plausible-sounding summary.',
    '',
    'Respond with exactly one line of JSON:',
    '{"passed": true|false, "note": "<one short sentence of justification>"}',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Read a verdict from a model reply. Anything unreadable is a FAIL, not a pass —
 * a verification step that defaults to success on confusion is worse than none,
 * because it manufactures false confidence.
 */
export function parseVerdict(reply: string): Verdict {
  const unreadable: Verdict = {
    passed: false,
    note: 'The verification step returned nothing usable, so the outcome is unconfirmed.',
  };
  if (!reply?.trim()) return unreadable;

  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], reply].filter((c): c is string => Boolean(c?.trim()));

  for (const candidate of candidates) {
    const text = candidate.trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const slice = start !== -1 && end > start ? text.slice(start, end + 1) : text;
    try {
      const parsed = JSON.parse(slice) as { passed?: unknown; note?: unknown };
      // Only a literal boolean true passes. A truthy string ("yes") does not —
      // that ambiguity is exactly where a lenient parser leaks false passes.
      if (typeof parsed.passed === 'boolean') {
        return {
          passed: parsed.passed,
          note: typeof parsed.note === 'string' ? parsed.note.slice(0, 300) : undefined,
        };
      }
    } catch {
      // try the next candidate
    }
  }
  return unreadable;
}

// ── Retry / escalation ────────────────────────────────────────────────────

export type RetryAction =
  /** Run it again unchanged — transient failure. */
  | 'retry'
  /** Run it again on a more capable tier — the model wasn't good enough. */
  | 'escalate'
  /** Stop and involve the human. */
  | 'ask'
  /** Stop. Nothing left to try. */
  | 'give_up'
  /** Nothing wrong. */
  | 'none';

export interface RetryDecision {
  action: RetryAction;
  /** Present for 'escalate'. */
  tier?: Tier;
  reason: string;
}

/**
 * Bound on automatic attempts per trigger. Retries cost real money on someone
 * else's schedule, so the ceiling is low and deliberate — an agent that retries
 * forever is a billing incident, not a feature.
 */
export const MAX_ATTEMPTS = 3;

/** Consecutive failures after which we stop retrying and ask the human. */
export const ASK_AFTER_CONSECUTIVE_FAILURES = 5;

/** The next more capable tier, or null at the ceiling. */
export function escalateTier(tier: Tier): Tier | null {
  const idx = TIER_ORDER.indexOf(tier);
  // TIER_ORDER runs premium → cheap, so "more capable" is toward index 0.
  if (idx <= 0) return null;
  return TIER_ORDER[idx - 1];
}

/**
 * What to do after a run.
 *
 * - An errored run is likely transient → retry unchanged.
 * - A run that succeeded but FAILED verification is a capability problem, not a
 *   transient one: repeating it on the same model will most likely fail the same
 *   way, so escalate the tier instead. This is where the registry's tier ladder
 *   earns its keep.
 * - A long failure streak stops being worth retrying and becomes something the
 *   human needs to see.
 */
export function decideRetry(params: {
  goal: Goal;
  run: Run;
  /** 1-based attempt number within this trigger. */
  attempt: number;
}): RetryDecision {
  const { goal, run, attempt } = params;

  const verificationFailed = run.verification ? !run.verification.passed : false;
  const errored = run.status === 'failed' || run.status === 'timeout';

  if (!errored && !verificationFailed) {
    return { action: 'none', reason: 'The run succeeded and met its criteria.' };
  }

  // A persistent problem is a human problem. Checked before the attempt ceiling
  // so a goal that fails every night escalates to the user instead of quietly
  // burning three attempts a day forever.
  if ((goal.consecutiveFailures ?? 0) >= ASK_AFTER_CONSECUTIVE_FAILURES) {
    return {
      action: 'ask',
      reason: `This goal has failed ${goal.consecutiveFailures} times in a row — it needs attention rather than another retry.`,
    };
  }

  if (attempt >= MAX_ATTEMPTS) {
    return { action: 'give_up', reason: `Stopped after ${attempt} attempts.` };
  }

  if (verificationFailed) {
    const current = goal.tier ?? 'good';
    const next = escalateTier(current);
    if (next) {
      return {
        action: 'escalate',
        tier: next,
        reason: `The work didn't meet its criteria on ${current}; retrying on ${next}.`,
      };
    }
    // Already at the top: a better model isn't available, so the criteria or the
    // instruction is the problem, and only the human can settle that.
    return {
      action: 'ask',
      reason: `The work didn't meet its criteria even on ${current}, the most capable tier — the goal or its criteria may need changing.`,
    };
  }

  return {
    action: 'retry',
    reason: run.error
      ? `The run failed (${run.error.slice(0, 120)}); retrying.`
      : 'The run failed; retrying.',
  };
}

/**
 * A one-line outcome for the UI that distinguishes the three states the Cockpit
 * must not conflate: errored, ran-but-didn't-achieve, and genuinely done.
 */
export function outcomeLabel(run: Run): string {
  if (run.status === 'failed') return 'Failed';
  if (run.status === 'timeout') return 'Timed out';
  if (run.status === 'cancelled') return 'Cancelled';
  if (run.status === 'running') return 'Running';
  if (run.status === 'awaiting_approval') return 'Needs approval';
  if (run.verification && !run.verification.passed) return 'Ran, but unmet';
  if (run.verification?.passed) return 'Verified';
  return 'Succeeded';
}

/** True when the run finished cleanly but did not achieve the goal. */
export function isUnmet(run: Run): boolean {
  return run.status === 'succeeded' && Boolean(run.verification && !run.verification.passed);
}
