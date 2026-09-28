import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import os from 'node:os';
import {
  DATA_DIR_NAME,
  LEGACY_DATA_DIR_NAME,
  MCP_CONFIG_FILENAME,
  LEGACY_MCP_CONFIG_FILENAME,
  MCP_CLIENTS_FILENAME,
  LEGACY_MCP_CLIENTS_FILENAME,
} from '@/config/branding';

/**
 * Which files under the user's home may the local API read, list or delete?
 *
 * The `/api/files/*` routes each carried their own copy of
 * `resolved.startsWith(home)`, which was wrong three ways at once:
 *   - `/Users/adam` is a string prefix of `/Users/adamX`, a different user;
 *   - the check ran on the SPELLING, so `~/proj/link -> ~/.ssh/id_rsa` passed
 *     and the read followed the link;
 *   - everything in home counted, and the extension allow-list waved through
 *     extensionless files, i.e. `~/.ssh/id_rsa`.
 *
 * Here both sides are realpath'd and compared with `path.relative`, and a
 * fixed list of credential locations is refused even though it is inside home.
 * The list is not a sandbox — the agent itself has shell access — it is the
 * floor for an HTTP endpoint any same-origin script can call with a path.
 */

/** Home-relative locations that hold credentials. Matched case-insensitively. */
const CREDENTIAL_LOCATIONS: readonly string[][] = [
  ['.ssh'],
  ['.aws'],
  ['.gnupg'],
  ['.config', 'gcloud'],
  ['.config', 'gh'],
  ['.azure'],
  ['.kube'],
  ['.docker', 'config.json'],
  ['.netrc'],
  ['.npmrc'],
  ['.pypirc'],
  ['.git-credentials'],
  ['.password-store'],
  ['Library', 'Keychains'],
  ['.local', 'share', 'keyrings'],
  ['.claude', '.credentials.json'],
  ['.claude', MCP_CLIENTS_FILENAME],
  ['.claude', LEGACY_MCP_CLIENTS_FILENAME],
  ['.claude', MCP_CONFIG_FILENAME],
  ['.claude', LEGACY_MCP_CONFIG_FILENAME],
];

/**
 * Basename prefixes refused inside a given home-relative directory: the MCP
 * config's temp and quarantine siblings (`.aime-mcp.json.<id>.tmp`,
 * `.aime-mcp.corrupt-<ts>.json`) hold the same OAuth tokens, as do the app's
 * encrypted credential store and its temp files.
 */
const CREDENTIAL_PREFIXES: ReadonlyArray<[dir: string, prefix: string]> = [
  ['.claude', '.aime-mcp'],
  ['.claude', '.quarry-mcp'],
  [DATA_DIR_NAME, 'credentials'],
  [DATA_DIR_NAME, '.credentials'],
  [LEGACY_DATA_DIR_NAME, 'credentials'],
  [LEGACY_DATA_DIR_NAME, '.credentials'],
];

function relativeInside(base: string, target: string, p = nodePath): string | null {
  const rel = p.relative(base, target);
  if (rel === '') return '';
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return null;
  return rel;
}

/** True when `target` is `base` or anywhere below it. Both must be resolved. */
export function isWithin(base: string, target: string, p = nodePath): boolean {
  return relativeInside(base, target, p) !== null;
}

/**
 * Is this (already resolved) path a credential location under `home`?
 * Pure; both arguments must be realpaths for the answer to mean anything.
 */
export function isCredentialPath(target: string, home: string, p = nodePath): boolean {
  const rel = relativeInside(home, target, p);
  if (rel === null || rel === '') return false;
  const segs = rel.split(p.sep).map((s) => s.toLowerCase());
  for (const loc of CREDENTIAL_LOCATIONS) {
    if (loc.length <= segs.length && loc.every((s, i) => s.toLowerCase() === segs[i])) return true;
  }
  if (segs.length === 2) {
    for (const [dir, prefix] of CREDENTIAL_PREFIXES) {
      if (segs[0] === dir.toLowerCase() && segs[1].startsWith(prefix.toLowerCase())) return true;
    }
  }
  return false;
}

export interface UserFileOptions {
  /** Home directory. Defaults to `os.homedir()`; a test seam. */
  home?: string;
  /** Roots a path may live under. Defaults to home + the temp directories. */
  roots?: string[];
}

async function realOr(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return nodePath.resolve(p);
  }
}

async function resolvedRoots(opts: UserFileOptions): Promise<{ home: string; roots: string[] }> {
  const home = await realOr(opts.home ?? os.homedir());
  const raw = opts.roots ?? [home, os.tmpdir(), '/tmp'];
  const roots = [...new Set(await Promise.all(raw.map(realOr)))];
  return { home, roots };
}

export type UserPathAccess =
  | { ok: true; path: string }
  | { ok: false; reason: 'forbidden' | 'not-found' };

function isUsableInput(raw: unknown): raw is string {
  return typeof raw === 'string' && raw !== '' && !raw.includes('\0');
}

/**
 * Resolve a user-supplied path to an EXISTING file or directory the API may
 * read or list. The returned path is the realpath — use it, not the input,
 * for the subsequent read, so a symlink swapped in later is not followed.
 */
export async function resolveUserPath(
  raw: unknown,
  opts: UserFileOptions = {},
): Promise<UserPathAccess> {
  if (!isUsableInput(raw)) return { ok: false, reason: 'forbidden' };
  let real: string;
  try {
    real = await fs.realpath(nodePath.resolve(raw));
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  const { home, roots } = await resolvedRoots(opts);
  if (!roots.some((r) => isWithin(r, real))) return { ok: false, reason: 'forbidden' };
  if (isCredentialPath(real, home)) return { ok: false, reason: 'forbidden' };
  return { ok: true, path: real };
}

/**
 * Resolve a file to DELETE inside a working directory.
 *
 * `unlink` removes a symlink rather than its target, so the parent directory
 * is realpath'd and the final name kept as given: deleting a link that points
 * at `~/.ssh/id_rsa` removes the link, and deleting `cwd/../outside` is refused.
 * The working directory itself comes from the request, so it must pass the same
 * root and credential checks as any other path.
 */
export async function resolveDeletableFile(
  rawPath: unknown,
  rawCwd: unknown,
  opts: UserFileOptions = {},
): Promise<UserPathAccess> {
  if (!isUsableInput(rawPath) || !isUsableInput(rawCwd)) return { ok: false, reason: 'forbidden' };
  const cwd = await resolveUserPath(rawCwd, opts);
  if (!cwd.ok) return cwd;

  const resolved = nodePath.resolve(cwd.path, rawPath);
  let parent: string;
  try {
    parent = await fs.realpath(nodePath.dirname(resolved));
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  const target = nodePath.join(parent, nodePath.basename(resolved));
  const rel = relativeInside(cwd.path, target);
  if (!rel) return { ok: false, reason: 'forbidden' };

  const { home } = await resolvedRoots(opts);
  if (isCredentialPath(target, home)) return { ok: false, reason: 'forbidden' };
  return { ok: true, path: target };
}
