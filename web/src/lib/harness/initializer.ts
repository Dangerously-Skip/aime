import {
  writeGoalOnce,
  writeLedger,
  readGoal,
  type Goal,
  type Ledger,
  type Task,
  type LedgerResult,
} from './ledger';

/**
 * Turn what the user asked for into a goal and a plan.
 *
 * This is the initializer session — run once, before any work. It is separate
 * from the execution sessions for the reason Anthropic's harness separates them:
 * the thing that decides what "done" means must not be the same thing that later
 * gets to declare itself done.
 *
 * Everything it produces is then IMMUTABLE to execution sessions. `goal.json`
 * cannot be rewritten at all, and a task's title and verification steps cannot be
 * touched — see `illegalChanges`. That asymmetry is the whole design: the plan is
 * cheap to make and expensive to change, so an agent that finds a task hard
 * cannot make it easier.
 */

/** Ids are ours, never the model's — stable, ordered, and impossible to collide. */
function taskId(index: number): string {
  return `t-${String(index + 1).padStart(3, '0')}`;
}

export function buildPlanPrompt(objective: string, context: string): string {
  return [
    `You are planning a long-running piece of work. You will NOT do the work now.`,
    ``,
    `# What the user asked for`,
    ``,
    objective,
    ``,
    context.trim() ? `# Context\n\n${context.trim()}\n` : '',
    `# What to produce`,
    ``,
    `A JSON object, and nothing else. No prose before or after.`,
    ``,
    '```json',
    `{`,
    `  "objective": "one sentence, the outcome — not the method",`,
    `  "acceptanceCriteria": ["how anyone would know the whole job is done"],`,
    `  "tasks": [`,
    `    {`,
    `      "title": "one concrete piece of work",`,
    `      "verify": ["a specific check someone else could run and observe"]`,
    `    }`,
    `  ]`,
    `}`,
    '```',
    ``,
    `# Rules for the task list`,
    ``,
    `- Order them. Each task should be startable once the ones before it are done.`,
    `- Each task is ONE session of work — a thing that can be finished and checked,`,
    `  not a theme like "improve performance".`,
    `- Every task needs at least one \`verify\` entry, and each must be OBSERVABLE:`,
    `  a command and its expected output, a URL and its expected status, a file`,
    `  and what should be in it. "Works correctly" is not a check. Another agent`,
    `  will run these to decide whether you are done, and it cannot read minds.`,
    `- Prefer more, smaller tasks. A task that turns out to be too big blocks the`,
    `  whole run; a task that turns out to be too small costs one cheap session.`,
    `- Do not include tasks for things already true. Check first.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * Pull the plan out of a model response.
 *
 * Fences and preamble are normal, so this looks for the outermost JSON object
 * rather than demanding the whole response parse. What it will NOT do is repair
 * a plan that is missing pieces: a task with no `verify` can never be checked,
 * which in phase 2 means it can never legitimately pass, so it is refused here
 * rather than written and discovered later.
 */
export function parsePlan(raw: string): LedgerResult<{ goal: Omit<Goal, 'createdAt'>; tasks: Task[] }> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return { ok: false, error: 'no JSON object in the response' };

  let data: unknown;
  try {
    data = JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `plan is not valid JSON: ${(e as Error).message}` };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'plan is not an object' };
  const o = data as Record<string, unknown>;

  const objective = typeof o.objective === 'string' ? o.objective.trim() : '';
  if (!objective) return { ok: false, error: 'plan has no objective' };

  if (!Array.isArray(o.tasks) || o.tasks.length === 0) {
    // An empty plan would be `isComplete === false` and `nextTask === null`,
    // which the loop reads as "everything is blocked". Refuse it here where the
    // message can say what actually went wrong.
    return { ok: false, error: 'plan has no tasks' };
  }

  const tasks: Task[] = [];
  for (const [i, t] of o.tasks.entries()) {
    if (typeof t !== 'object' || t === null) return { ok: false, error: `task ${i} is not an object` };
    const r = t as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) return { ok: false, error: `task ${i} has no title` };
    const verify = Array.isArray(r.verify)
      ? r.verify.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [];
    if (verify.length === 0) {
      return { ok: false, error: `task "${title}" has no verification steps` };
    }
    tasks.push({
      id: taskId(i),
      title,
      verify: verify.map((v) => v.trim()),
      status: 'todo',
      attempts: 0,
      lastVerdict: null,
    });
  }

  return {
    ok: true,
    value: {
      goal: {
        version: 1,
        objective,
        acceptanceCriteria: Array.isArray(o.acceptanceCriteria)
          ? o.acceptanceCriteria.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
          : [],
        budgetUsd: null,
        deadlineIso: null,
        sessionCap: null,
      },
      tasks,
    },
  };
}

export interface InitOptions {
  dir: string;
  objective: string;
  context?: string;
  /** Stop conditions the user chose. Not the model's to decide. */
  budgetUsd: number | null;
  deadlineIso: string | null;
  sessionCap: number | null;
  /** Runs the planning session; injected so this is testable without a model. */
  plan: (prompt: string) => Promise<string>;
  nowIso?: () => string;
}

export type InitResult =
  | { ok: true; goal: Goal; ledger: Ledger }
  | { ok: false; error: string };

/**
 * Write the goal and the plan, once.
 *
 * Refuses if a goal already exists. Re-planning over a run in progress would
 * orphan its ledger and its progress log, and the honest recovery is a new
 * conversation rather than a silent overwrite.
 */
export async function initializeGoal(opts: InitOptions): Promise<InitResult> {
  const existing = await readGoal(opts.dir);
  if (existing.ok) {
    return { ok: false, error: 'this conversation already has a goal' };
  }
  if (!opts.objective.trim()) return { ok: false, error: 'objective required' };

  let raw: string;
  try {
    raw = await opts.plan(buildPlanPrompt(opts.objective, opts.context ?? ''));
  } catch (e) {
    return { ok: false, error: `planning failed: ${(e as Error).message}` };
  }

  const parsed = parsePlan(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const goal: Goal = {
    ...parsed.value.goal,
    /*
     * The stop conditions come from the USER, not the plan. A model that also
     * sets its own budget has no budget — and the planner has every incentive to
     * be optimistic about what its work will cost.
     */
    budgetUsd: opts.budgetUsd,
    deadlineIso: opts.deadlineIso,
    sessionCap: opts.sessionCap,
    createdAt: (opts.nowIso ?? (() => new Date().toISOString()))(),
  };

  const written = await writeGoalOnce(opts.dir, goal);
  if (!written.ok) return { ok: false, error: written.error };

  const ledger: Ledger = { version: 1, tasks: parsed.value.tasks };
  await writeLedger(opts.dir, ledger);
  return { ok: true, goal, ledger };
}
