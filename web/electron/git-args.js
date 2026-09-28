/**
 * Arguments for `git push`, from a branch name the renderer supplied.
 *
 * The branch was passed straight through as an argv entry: `git push -u origin
 * <branch>`. No shell, so no command injection — but git parses its OWN argv,
 * and a "branch" of `--receive-pack=<cmd>` is an option to git, one that runs a
 * command. `--mirror`, `--force` and `--delete` are options too. So the name is
 * validated, and `--` goes before it so that even a name the check missed is
 * read as a refspec, never as an option.
 */

/**
 * Why a branch name is refused, or null if it is acceptable.
 *
 * Not a full `git check-ref-format` — git still has the final word on the ref.
 * This refuses what could be read as something other than a ref name.
 */
function branchNameProblem(branch) {
  if (typeof branch !== "string" || !branch) return "Branch name is required.";
  if (branch.length > 255) return "Branch name is too long.";
  if (branch.startsWith("-")) return "Branch name cannot start with '-'.";
  // `+<ref>` is a FORCE refspec, and `--` does not change that — it is not an option.
  if (branch.startsWith("+")) return "Branch name cannot start with '+'.";
  if (/\s/.test(branch)) return "Branch name cannot contain whitespace.";
  if (branch.includes("..")) return "Branch name cannot contain '..'.";
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(branch)) return "Branch name contains a character git does not allow.";
  if (branch.includes("@{")) return "Branch name cannot contain '@{'.";
  if (branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.endsWith(".lock")) {
    return "Branch name is not a valid ref.";
  }
  return null;
}

/** `git push` argv for `branch`, or throws with the reason it was refused. */
function pushArgs(branch) {
  const problem = branchNameProblem(branch);
  if (problem) throw new Error(problem);
  return ["push", "-u", "origin", "--", branch];
}

module.exports = { branchNameProblem, pushArgs };
