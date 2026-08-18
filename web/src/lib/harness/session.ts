import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PROGRESS_FILE, type Goal, type Task } from './ledger';
import { parseRevision, REVISION_MARKER, type Revision } from './revision';
import type { SessionInput, SessionOutcome, SessionRunner } from './goal-loop';

/**
 * One session of a goal run: a single task, handed to the agent, bounded.
 *
 * The three pure pieces here — the prompt, the status parse and the progress
 * tail — are separated from the provider call because they are the parts that
 * decide whether the loop behaves, and the provider call is the part that cannot
 * run in a test.
 */

/**
 * How a session reports whether it finished.
 *
 * A marker rather than prose, because "I've completed the task" and "I've
 * completed the changes but haven't verified them" are the same sentence to a
 * regex and very different facts. The marker is the only thing read.
 */
export const COMPLETE_MARKER = 'STATUS: COMPLETE';
export const INCOMPLETE_MARKER = 'STATUS: INCOMPLETE';

/**
 * The third ending: the session cannot proceed without a decision only the user
 * can make.
 *
 * Distinct from INCOMPLETE on purpose. "I did not finish" gets retried; "I need
 * to know which database you want" retried forty times is the runaway this whole
 * design exists to avoid, and no amount of retrying produces the answer.
 */
export const QUESTION_MARKER = 'STATUS: QUESTION';

/**
 * Did the session claim completion?
 *
 * ABSENCE IS NOT SUCCESS. A run that ended without saying either — because it hit
 * the turn ceiling, crashed, or simply forgot — is incomplete. The same rule the
 * pending-questions bridge applies to silence, and for the same reason: the
 * expensive mistake is reading "no answer" as "yes".
 */
/** The question a session ended on, if it ended on one. */
export function parseSessionQuestion(text: string): { question: string; options: string[] } | null {
  const tail = text.slice(-2000);
  const at = tail.lastIndexOf(QUESTION_MARKER);
  if (at === -1) return null;
  const asked = tail.slice(at + QUESTION_MARKER.length).replace(/^[:\s]+/, '').trim();
  // A marker with nothing after it is not a question; treating it as one would
  // park the run on a blank prompt.
  if (!asked) return null;
  const line = asked.split('\n')[0].slice(0, 700);

  /*
   * `question || option | option` — options are the point.
   *
   * A question that arrives as free text makes the user type an answer they
   * could have clicked, and inventing the wording risks an answer the run does
   * not recognise. The session knows the alternatives; it should offer them.
   */
  const [q, opts] = line.split('||');
  return {
    question: q.trim().slice(0, 500),
    options: (opts ?? '')
      .split('|')
      .map((o) => o.trim())
      .filter((o) => o !== '')
      .slice(0, 5),
  };
}

export function parseSessionStatus(text: string): boolean {
  // Search the tail only. A session that quotes the instructions early on, or
  // reasons aloud about what completion would mean, must not trip this.
  const tail = text.slice(-2000);
  const lastComplete = tail.lastIndexOf(COMPLETE_MARKER);
  const lastIncomplete = tail.lastIndexOf(INCOMPLETE_MARKER);
  if (lastComplete === -1) return false;
  // Both present: the later one wins, since a session may change its mind after
  // testing. `INCOMPLETE` contains no substring collision with `COMPLETE`
  // because the prefix differs, so these indices are independent.
  return lastComplete > lastIncomplete;
}

/** The last few sessions of the log — enough to orient, not enough to bloat. */
export async function progressTail(dir: string, maxChars = 4000): Promise<string> {
  try {
    const text = await fs.readFile(path.join(dir, PROGRESS_FILE), 'utf8');
    return text.length <= maxChars ? text : `…\n${text.slice(-maxChars)}`;
  } catch {
    return '';
  }
}

export interface PromptParts {
  goal: Goal;
  task: Task;
  sessionIndex: number;
  missing: string[];
  progress: string;
  answer?: string | null;
}

/**
 * What the session is told.
 *
 * Shaped by the failure modes rather than by tidiness:
 *
 *   - ONE task, named, with its verification steps. Anthropic's harness found
 *     that a list invites the model to attempt everything and declare victory.
 *   - The previous verifier's `missing` list VERBATIM. Paraphrasing feedback is
 *     how a loop repeats the same failure with different words.
 *   - An explicit instruction to test. The single biggest observed failure in a
 *     long-running harness was an agent that made changes and "would fail to
 *     recognise that the feature didn't work end-to-end" — and it did not test
 *     unless told to, every time.
 *   - A prohibition on editing the plan, which is enforced anyway by the loop's
 *     tamper check. Both: the instruction saves a wasted session, the check is
 *     what makes it true.
 */
export function buildSessionPrompt(parts: PromptParts): string {
  const { goal, task, sessionIndex, missing, progress } = parts;
  const lines: string[] = [];

  lines.push(`# Goal`, goal.objective, '');
  if (goal.acceptanceCriteria.length) {
    lines.push(`This is done when:`);
    for (const c of goal.acceptanceCriteria) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push(`# Your task this session (session ${sessionIndex})`, '');
  lines.push(`**${task.title}**`, '');
  if (task.verify.length) {
    lines.push(`It is complete when all of these hold:`);
    for (const v of task.verify) lines.push(`- ${v}`);
    lines.push('');
  }

  if (parts.answer) {
    lines.push(`# You asked a question and were answered`, '', parts.answer.trim(), '');
  }

  if (missing.length) {
    lines.push(`## The last attempt was rejected for these reasons`, '');
    for (const m of missing) lines.push(`- ${m}`);
    lines.push('', 'Address these specifically. Do not start over.', '');
  }

  if (progress.trim()) {
    lines.push(`# What previous sessions did`, '', progress.trim(), '');
  }

  lines.push(
    `# Rules`,
    '',
    `- Work on THIS TASK ONLY. Do not start other tasks, even if they look quick.`,
    `- TEST YOUR WORK END TO END before claiming it is done. Run the commands,`,
    `  open the page, check the output. A change that compiles is not a change`,
    `  that works.`,
    `- Do not edit the goal or task list FILES directly — those edits are`,
    `  rejected and the session is wasted. If the PLAN itself is wrong, say so the`,
    `  proper way; see below.`,
    `- Leave the working tree in a state someone else could pick up.`,
    '',
    `# Finish by saying exactly one of these on its own line`,
    '',
    `${COMPLETE_MARKER}    — you tested it and every verification step holds`,
    `${INCOMPLETE_MARKER}  — anything else, including "nearly"`,
    `${QUESTION_MARKER} <your question> || <option> | <option>`,
    `  ONLY when a decision is genuinely the user's to make and no amount of`,
    `  investigation would settle it. This stops the run until they answer, so do`,
    `  not use it to check work you could do. ALWAYS offer the alternatives after`,
    `  \`||\` so they can be clicked — for example:`,
    `  ${QUESTION_MARKER} Which total should this compute? || gross | net`,
    '',
    `Saying neither counts as ${INCOMPLETE_MARKER}.`,
    '',
    `# If the PLAN is wrong`,
    '',
    `Say \`${REVISION_MARKER}\` and a JSON object, alongside your status:`,
    '',
    '```json',
    `{ "add": [{"title": "...", "verify": ["..."]}], "remove": ["t-00X"], "reason": "why" }`,
    '```',
    '',
    `Adding work is applied straight away — finding more to do is normal. REMOVING`,
    `a task stops the run to ask the user, because dropping work shrinks what`,
    `"done" means. A task that has already passed cannot be removed at all, and`,
    `every added task needs its own verify steps.`,
  );

  return lines.join('\n');
}

/** Everything the runner needs from the outside world. */
export interface SessionDeps {
  /** Yields provider chunks. Injected so the loop is testable without a model. */
  query: (args: {
    prompt: string;
    chatId: string;
    maxTurns: number;
    cwd: string;
  }) => AsyncIterable<{ type: string; content?: unknown; [k: string]: unknown }>;
  chatId: string;
  cwd: string;
  maxTurns: number;
  /** Estimator for backends that do not report a price. */
  estimateCostUsd?: (inputTokens: number, outputTokens: number) => number;
}

/**
 * A `SessionRunner` backed by a real provider.
 *
 * Cost is taken from `total_cost_usd` when the backend reports it and estimated
 * otherwise. That fallback is not optional: `total_cost_usd` is an Anthropic-API
 * field, so on Bedrock, Vertex and OpenRouter it is undefined — and a spend that
 * always reads zero makes the budget stop condition decorative on exactly the
 * accounts where a mis-set ceiling costs real money.
 */
export function createSessionRunner(deps: SessionDeps): SessionRunner {
  return async (input: SessionInput): Promise<SessionOutcome> => {
    const progress = await progressTail(input.dir);
    const prompt = buildSessionPrompt({
      goal: input.goal,
      task: input.task,
      sessionIndex: input.sessionIndex,
      missing: input.missing,
      progress,
      answer: input.answer ?? null,
    });

    let text = '';
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let error: string | undefined;

    try {
      for await (const chunk of deps.query({
        prompt,
        chatId: deps.chatId,
        maxTurns: deps.maxTurns,
        cwd: deps.cwd,
      })) {
        if (chunk.type === 'text' && typeof chunk.content === 'string') {
          text += chunk.content;
        } else if (chunk.type === 'error') {
          error = typeof chunk.content === 'string' ? chunk.content : 'provider error';
        } else if (chunk.type === 'usage') {
          /*
           * `usage`, not `done`.
           *
           * This listened for a chunk type that does not exist. The provider
           * emits `type: 'usage'` (claude-provider.ts) and nothing else carries
           * the token counts, so cost was always 0 and the budget stop condition
           * — the one limit that maps onto what a user actually cares about —
           * was inert. A real run finished two sessions with spentUsd: 0.
           *
           * The unit tests did not catch it because the fake provider in them
           * emitted the chunk type I had invented rather than the one the
           * provider sends. See session-chunk-types.test.ts, which derives the
           * name from the provider source.
           */
          const usage = chunk as {
            totalCostUsd?: number;
            inputTokens?: number;
            outputTokens?: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
          };
          if (typeof usage.totalCostUsd === 'number') {
            costUsd = usage.totalCostUsd;
          } else {
            inputTokens =
              (usage.inputTokens ?? 0) +
              (usage.cacheReadInputTokens ?? 0) +
              (usage.cacheCreationInputTokens ?? 0);
            outputTokens = usage.outputTokens ?? 0;
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (costUsd === 0 && (inputTokens || outputTokens) && deps.estimateCostUsd) {
      costUsd = deps.estimateCostUsd(inputTokens, outputTokens);
    }

    const asked = parseSessionQuestion(text);

    return {
      question: asked?.question ?? null,
      questionOptions: asked?.options ?? [],
      revision: parseRevision(text),
      costUsd,
      // The summary is what a human reads later, so keep the model's own words
      // rather than a template. Trimmed because the whole transcript is not a
      // summary.
      summary: text.trim().slice(-1500) || '(the session produced no output)',
      claimsComplete: !error && parseSessionStatus(text),
      error,
    };
  };
}
