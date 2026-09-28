/**
 * Which branch "HEAD vs base branch" should compare against.
 *
 * The diff viewer hardcoded `main`, so on a `master` or `develop` repo the mode
 * failed or diffed against nothing. Order of preference:
 *
 *   1. `origin/HEAD` — the remote's declared default. `git:status` reports it
 *      as `baseBranch` when the current branch has no upstream; when it DOES
 *      have one, `baseBranch` is that upstream (`origin/<this branch>`), which
 *      is not a base at all, so it is skipped.
 *   2. `main`, then `master`, then `develop` — local first, then `origin/…`.
 *   3. Otherwise null: there is nothing sensible to guess, and the picker lets
 *      the user choose.
 */
export const DEFAULT_BRANCH_CANDIDATES = ['main', 'master', 'develop'] as const;

const stripRemote = (ref: string) => ref.replace(/^[^/]+\//, '');

export function detectDefaultBranch(input: {
  /** `GitStatus.baseBranch` — upstream, or origin/HEAD's target when none. */
  baseBranch?: string | null;
  /** `GitStatus.branch` — the checked-out branch. */
  currentBranch?: string | null;
  /** `git:branches` — local and remote short names. */
  branches: readonly string[];
}): string | null {
  const { baseBranch, currentBranch, branches } = input;
  const known = new Set(branches);

  if (baseBranch && baseBranch.includes('/') && stripRemote(baseBranch) !== currentBranch) {
    return baseBranch;
  }
  for (const name of DEFAULT_BRANCH_CANDIDATES) {
    if (known.has(name)) return name;
    if (known.has(`origin/${name}`)) return `origin/${name}`;
  }
  return null;
}
