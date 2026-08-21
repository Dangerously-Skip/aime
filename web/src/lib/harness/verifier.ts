import { RetrievalLog, unretrievedCitations, citationFailure } from './evidence';
import type { Goal, Task, TaskVerdict } from './ledger';
import type { Decision } from './question';

/**
 * The checker half of maker-checker.
 *
 * WHY IT EXISTS. The human in the outer loop does two jobs — deciding what is
 * next, and checking what just happened. Phase 1 automated only the first, so a
 * task passed on the executing session's own say-so. A model grading its own
 * output skews positive every time, and this app has already shipped the
 * consequence: a deck agent reported "all 9 videos are properly embedded" when
 * every one of them returned Error 153.
 *
 * WHY IT CANNOT WRITE. A checker that can fix things becomes a second maker and
 * the split collapses — it would repair the gap it found and report a pass,
 * which is indistinguishable from there never having been a gap. So every write
 * tool is denied, and denied via `deniedTools`, which is enforced twice, rather
 * than by narrowing `allowedTools`, which is an auto-approve list and withholds
 * nothing.
 *
 * WHY BASH STAYS. Running the checks IS the job. A verifier that can only read
 * code and form an opinion is the rubber stamp this module exists to prevent.
 * Bash can write, so that hole is closed by a rule instead of a permission: the
 * working tree is fingerprinted before and after, and a verdict from a run that
 * changed the tree is DISCARDED. See `treeUnchanged`.
 *
 * WHY ONE VERIFIER AND NOT A PANEL. The adversarial-panel pattern earns its cost
 * when a finding is contestable and can fail in several unrelated ways. Here the
 * acceptance criteria were written down in advance, by a different session, and
 * mostly mean "run this and look at the output". Three verifiers would triple
 * the cost of every task to re-answer a settled question. If this one turns out
 * to rubber-stamp, that is the evidence for adding lenses.
 */

/** Write tools the verifier must never have. Bash is deliberately absent — see above. */
export const VERIFIER_DENIED = [
  'Write',
  'Edit',
  'NotebookEdit',
  'ExcelWrite',
  'ExcelEdit',
  'mcp__aime__CreateImage',
];

/** What the verifier may reach for. */
export const VERIFIER_TOOLS = ['Read', 'Glob', 'Grep', 'Bash', 'mcp__aime__FetchUrl'];

export function buildVerifierPrompt(
  goal: Goal,
  task: Task,
  summary: string,
  decisions: Decision[] = [],
): string {
  return [
    `You are checking someone else's work. You did not do it and you have no stake in it.`,
    ``,
    `# The overall goal`,
    ``,
    goal.objective,
    ``,
    `# The task that claims to be finished`,
    ``,
    `**${task.title}**`,
    ``,
    ...(decisions.length
      ? [
          `# Decisions the user has already made`,
          ``,
          /*
           * The verifier reads the working tree and runs commands; it cannot see
           * a conversation. Without this it rejected a correctly finished task
           * twice — "the conversation does not contain an unambiguous user
           * answer" — which was scepticism working exactly as designed against
           * evidence it had never been shown.
           */
          ...decisions.map((d) => `- Asked: ${d.question}\n  Answered: **${d.answer}**`),
          ``,
          `These are settled. Treat them as given, and check the work against`,
          `them — a task that exists to obtain a decision is complete once the`,
          `answer above exists.`,
          ``,
        ]
      : []),
    `# It is done only if ALL of these hold`,
    ``,
    ...task.verify.map((v, i) => `${i + 1}. ${v}`),
    ``,
    `# What the last session said it did`,
    ``,
    summary.trim() || '(nothing)',
    ``,
    `# How to check`,
    ``,
    `RUN the checks. Do not read the code and reason about whether it should`,
    `work — execute the commands, fetch the URLs, open the files, and look at`,
    `what actually comes back. An assurance is not evidence.`,
    ``,
    `You cannot edit anything, and you must not try. If a check fails, that is`,
    `the answer, not a problem for you to fix.`,
    ``,
    `# Answer with a JSON object and nothing else`,
    ``,
    '```json',
    `{`,
    `  "passed": false,`,
    `  "missing": ["exactly which verification steps do not hold, and how they failed"],`,
    `  "evidence": ["the command you ran and what it returned", "the URL and its status"]`,
    `}`,
    '```',
    ``,
    `\`evidence\` is required when you pass something. A pass with no evidence is`,
    `read as a failure, because it is indistinguishable from a guess.`,
  ].join('\n');
}

/**
 * Read a verdict, refusing the shapes that would let a guess through.
 *
 * Two rules are enforced HERE rather than asked for in the prompt, because a
 * prompt is a request and this is a gate:
 *
 *   - A pass with no evidence is a failure. The verifier is being asked to
 *     assert something; an assertion with nothing behind it is exactly the
 *     "all 9 videos are properly embedded" failure in a different costume.
 *   - An unreadable answer is a failure. Absence of a verdict is not a pass, the
 *     same reading of silence the session status parser and pending-questions
 *     both apply.
 */
export function parseVerdict(raw: string, at: string): TaskVerdict {
  const fail = (why: string): TaskVerdict => ({
    passed: false,
    missing: [why],
    evidence: [],
    at,
  });

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return fail('The verifier did not return a verdict.');

  let data: unknown;
  try {
    data = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return fail('The verifier’s answer could not be read.');
  }
  if (typeof data !== 'object' || data === null) return fail('The verifier’s answer was not an object.');
  const o = data as Record<string, unknown>;

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

  const missing = asStrings(o.missing);
  const evidence = asStrings(o.evidence);
  const claimed = o.passed === true;

  if (claimed && evidence.length === 0) {
    return {
      passed: false,
      missing: ['The verifier passed this without citing any evidence, so it was not accepted.'],
      evidence: [],
      at,
    };
  }
  if (claimed && missing.length > 0) {
    // Passing while listing unmet steps is a contradiction; take the pessimistic
    // reading, since the cost of a wrong pass is the whole point of the gate.
    return { passed: false, missing, evidence, at };
  }
  if (!claimed && missing.length === 0) {
    return { passed: false, missing: ['The verifier failed this without saying why.'], evidence, at };
  }

  return { passed: claimed, missing, evidence, at };
}

/**
 * Did the verifier leave the working tree alone?
 *
 * Bash is the hole in a read-only tool list, and this is the rule that closes
 * it. A verifier that edits is not a verifier — it has repaired the gap it was
 * meant to report, and the pass it then issues describes a world it created.
 */
export function treeUnchanged(before: string, after: string): boolean {
  const norm = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== '')
      .sort()
      .join('\n');
  return norm(before) === norm(after);
}

export interface VerifierDeps {
  /** Yields provider chunks for the verifying session. */
  query: (prompt: string) => AsyncIterable<{ type: string; content?: unknown }>;
  /** `git status --porcelain`, or equivalent. Empty string when not a repo. */
  treeFingerprint: () => Promise<string>;
  nowIso?: () => string;
  /**
   * What this run actually fetched, so a citation can be checked rather than
   * taken on trust (DR-22 D-3).
   *
   * Optional because a run with no retrieval at all — make ./check.sh pass —
   * has nothing to check against, and demanding a log there would fail every
   * local task. Absent means the URL check does not run; it does NOT mean
   * citations are accepted, because the no-evidence rule still applies.
   */
  retrieved?: () => RetrievalLog;
}

export type Verifier = (
  goal: Goal,
  task: Task,
  summary: string,
  decisions?: Decision[],
) => Promise<TaskVerdict>;

export function createVerifier(deps: VerifierDeps): Verifier {
  return async (goal, task, summary, decisions = []) => {
    const at = (deps.nowIso ?? (() => new Date().toISOString()))();
    const before = await deps.treeFingerprint().catch(() => '');

    let text = '';
    try {
      for await (const chunk of deps.query(buildVerifierPrompt(goal, task, summary, decisions))) {
        if (chunk.type === 'text' && typeof chunk.content === 'string') text += chunk.content;
        else if (chunk.type === 'error') {
          return {
            passed: false,
            missing: [`The verifier failed to run: ${String(chunk.content ?? 'provider error')}`],
            evidence: [],
            at,
          };
        }
      }
    } catch (e) {
      return {
        passed: false,
        missing: [`The verifier failed to run: ${(e as Error).message}`],
        evidence: [],
        at,
      };
    }

    const verdict = parseVerdict(text, at);

    /*
     * EVERY CITED URL MUST HAVE BEEN FETCHED (DR-22 D-3).
     *
     * The no-evidence rule above already refuses a bare pass, but the evidence
     * itself is free text the verifier wrote — so the one control between a
     * claim and the ledger could be satisfied by a plausible-looking URL the run
     * had never opened. That is precisely the failure that happened: market
     * values recalled from weights, wrong by three to four times, with the
     * whole ranking computed from them.
     *
     * Only applied to a PASS. A failing verdict citing a bad URL is already
     * failing, and adding a second reason helps nobody.
     */
    if (verdict.passed && deps.retrieved) {
      const bad = unretrievedCitations(verdict.evidence, deps.retrieved());
      if (bad.length > 0) {
        return { passed: false, missing: [citationFailure(bad)], evidence: verdict.evidence, at };
      }
    }

    const after = await deps.treeFingerprint().catch(() => before);
    if (!treeUnchanged(before, after)) {
      /*
       * Discarded, not downgraded to "failed because it edited". The verdict is
       * void: we no longer know whether the task passed before the verifier
       * touched anything, and the honest answer is that this attempt told us
       * nothing.
       */
      return {
        passed: false,
        missing: [
          'The verifier changed the working tree, so its verdict was discarded. ' +
            'It is only allowed to check, not to fix.',
        ],
        evidence: verdict.evidence,
        at,
      };
    }

    return verdict;
  };
}
