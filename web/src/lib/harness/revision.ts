import type { Ledger, Task } from './ledger';

/**
 * Changing the plan, mid-run.
 *
 * WHY THIS EXISTS. Until now the plan was fixed at initialisation, so a run that
 * discovered the plan was wrong could only fail tasks or ask. That is not how
 * long work goes — Devin's team put it plainly: "the plan changes a lot over
 * time. This isn't a failure mode, it's the design."
 *
 * WHY IT IS NOT SIMPLY ALLOWED. The whole reason `illegalChanges` exists is that
 * an agent which can edit the plan can make a hard task easy by deleting it.
 * Revision has to be possible without becoming that. The split is by
 * CONSEQUENCE, not by effort:
 *
 *   ADDING work is applied automatically. Discovering more to do is honest, it
 *   is the common case, and it can only make the run longer — never make it
 *   falsely succeed. Asking permission for it would train the user to click yes.
 *
 *   REMOVING work, or changing what "done" means, needs the user. Both shrink
 *   the definition of success, which is exactly the move reward hacking makes.
 *   These park a question (see question.ts) rather than being refused outright,
 *   because sometimes a task really is wrong.
 *
 * A passed task cannot be removed at all. Its verdict is evidence that work was
 * done and checked; deleting it would erase the record rather than change the
 * plan.
 */

export interface ProposedTask {
  title: string;
  verify: string[];
}

export interface Revision {
  add: ProposedTask[];
  remove: string[];
  reason: string;
}

export type RevisionKind = 'none' | 'auto' | 'needs-approval';

export interface ClassifiedRevision {
  kind: RevisionKind;
  revision: Revision;
  /** Why approval is needed, in words a user can act on. */
  approvalPrompt?: string;
  /** Rejected outright — not a matter of permission. */
  refusals: string[];
}

export const REVISION_MARKER = 'STATUS: REVISE';

/**
 * Read a proposed revision out of a session's output.
 *
 * Returns null when there is no proposal, which is the overwhelmingly common
 * case and must not be an error.
 */
export function parseRevision(text: string): Revision | null {
  const at = text.lastIndexOf(REVISION_MARKER);
  if (at === -1) return null;
  const after = text.slice(at + REVISION_MARKER.length);

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(after);
  const candidate = fenced ? fenced[1] : after;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let data: unknown;
  try {
    data = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;

  const add: ProposedTask[] = Array.isArray(o.add)
    ? o.add
        .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
        .map((t) => ({
          title: typeof t.title === 'string' ? t.title.trim() : '',
          verify: Array.isArray(t.verify)
            ? t.verify.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
            : [],
        }))
        .filter((t) => t.title !== '')
    : [];

  const remove: string[] = Array.isArray(o.remove)
    ? o.remove.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
    : [];

  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  if (add.length === 0 && remove.length === 0) return null;
  return { add, remove, reason };
}

/** Ids continue past the highest ever used, so a retired id is never reused. */
function nextId(ledger: Ledger): (offset: number) => string {
  // Retired ids count: a shrunk ledger cannot otherwise tell you the highest it
  // ever issued, and reusing a retired id would make an old run record look like
  // it referred to a new task.
  const seen = [...ledger.tasks.map((t) => t.id), ...(ledger.retiredIds ?? [])];
  const highest = seen.reduce((max, id) => {
    const n = Number(/^t-(\d+)$/.exec(id)?.[1] ?? 0);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return (offset) => `t-${String(highest + 1 + offset).padStart(3, '0')}`;
}

export function classifyRevision(ledger: Ledger, revision: Revision): ClassifiedRevision {
  const refusals: string[] = [];
  const byId = new Map(ledger.tasks.map((t) => [t.id, t]));

  if (!revision.reason) {
    refusals.push('A plan change needs a reason.');
  }

  for (const t of revision.add) {
    if (t.verify.length === 0) {
      // Same rule the initializer applies: a task nothing can check can never
      // legitimately pass.
      refusals.push(`"${t.title}" has no verification steps.`);
    }
  }

  const removable: string[] = [];
  for (const id of revision.remove) {
    const task = byId.get(id);
    if (!task) {
      refusals.push(`There is no task ${id}.`);
    } else if (task.status === 'passed') {
      // Its verdict is evidence. Deleting it erases the record rather than
      // changing the plan.
      refusals.push(`${id} has already passed and cannot be removed.`);
    } else {
      removable.push(id);
    }
  }

  if (refusals.length > 0 && revision.add.length === 0 && removable.length === 0) {
    return { kind: 'none', revision, refusals };
  }

  if (removable.length > 0) {
    const titles = removable.map((id) => `"${byId.get(id)!.title}"`).join(', ');
    return {
      kind: 'needs-approval',
      revision,
      refusals,
      approvalPrompt:
        `The run wants to drop ${removable.length} task${removable.length === 1 ? '' : 's'} — ${titles}. ` +
        `Reason: ${revision.reason || '(none given)'}. Allow it?`,
    };
  }

  return { kind: revision.add.length > 0 ? 'auto' : 'none', revision, refusals };
}

/** Apply the parts that are allowed. Removals only when `includeRemovals`. */
export function applyRevision(
  ledger: Ledger,
  revision: Revision,
  includeRemovals: boolean,
): Ledger {
  const id = nextId(ledger);
  const passed = new Set(ledger.tasks.filter((t) => t.status === 'passed').map((t) => t.id));
  const dropping = includeRemovals
    ? new Set(revision.remove.filter((r) => !passed.has(r)))
    : new Set<string>();

  const kept = ledger.tasks.filter((t) => !dropping.has(t.id));
  const added: Task[] = revision.add
    .filter((t) => t.verify.length > 0)
    .map((t, i) => ({
      id: id(i),
      title: t.title,
      verify: t.verify,
      status: 'todo' as const,
      attempts: 0,
      lastVerdict: null,
    }));

  const retiredIds = [...new Set([...(ledger.retiredIds ?? []), ...dropping])];
  return {
    version: 1,
    tasks: [...kept, ...added],
    ...(retiredIds.length ? { retiredIds } : {}),
  };
}
