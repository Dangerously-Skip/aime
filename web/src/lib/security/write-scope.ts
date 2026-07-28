/**
 * Where the file tools may write when "Restrict writes to project folder" is on.
 *
 * This setting used to be a sentence in the system prompt asking the model
 * nicely. Unlike a shell command — which cannot be classified reliably, see
 * ./destructive-commands — a write target IS decidable: resolve it and check
 * whether it lands under the base. So this one is enforced.
 *
 * ## What it does not cover, deliberately
 *
 * The file TOOLS, not "writes". `Bash` with `echo x > /etc/y` resolves nothing
 * here and is unaffected; that is the destructive-command gate's job. The
 * setting's description says as much, because a control that oversells its reach
 * is the exact bug this branch has been unpicking.
 *
 * ## The carve-outs, and why they are not holes
 *
 * A naive "must be under cwd" check breaks the app on its first turn: scratch
 * directories live at `~/.aime/scratch/<chatId>`, outside any project folder, and
 * the agent writes intermediates there by design. Temp is allowed for the same
 * reason — a Python script staging a file in `os.tmpdir()` is ordinary work, and
 * a user restricting writes to their project means "don't touch my other
 * projects and my home directory", not "never use a temp file".
 *
 * Both carve-outs are directories the app already owns or that hold nothing of
 * the user's. What stays refused is the interesting part: `~/`, a sibling repo,
 * `/etc`, and every `../` climb out of the project.
 */
import * as os from 'os';
import { getDataDir } from '../app-paths';
import { resolveWithinTree } from '../path-containment';

/** Tools that take a path and write to it. */
export const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * May this path be written, given the working directory?
 *
 * `chatId` is accepted for symmetry with the scratch layout but not needed to
 * decide: the whole data dir is permitted, and every chat's scratch is under it.
 * Passing the chat's own scratch dir only would refuse the shared subfolders the
 * document and skill writers already use.
 */
export function writeTargetAllowed(
  target: string,
  cwd: string,
  _chatId?: string,
  deps: { dataDir?: string; tmpDir?: string } = {},
): boolean {
  const dataDir = deps.dataDir ?? getDataDir();
  const tmpDir = deps.tmpDir ?? os.tmpdir();
  return [cwd, dataDir, tmpDir].some((base) => resolveWithinTree(base, target).ok);
}
