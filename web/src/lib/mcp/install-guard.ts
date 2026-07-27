/**
 * Plugin install input validation (P3.1).
 *
 * `/api/mcp/install` took `name` and `source` from the request and fed them to
 * `exec()` through template strings. Three ways that went wrong:
 *
 *  1. `name` reached `join(PLUGINS_DIR, name)` unchecked, so `../../.ssh`
 *     escaped the plugins directory and `git clone`d into it.
 *  2. Values were interpolated with `JSON.stringify`, which yields *double*
 *     quotes — and `sh` performs command substitution inside double quotes, so
 *     a name of `$(curl …|sh)` executed. (Verified, not theorised.)
 *  3. `--branch ${ref}` was interpolated with no quoting at all.
 *
 * The route now uses `execFile` with an argv array (no shell at all), which
 * removes (2) and (3) as a class. This module handles what argv can't: keeping
 * paths inside their directory, refusing git transports that execute commands,
 * and refusing values that would be read as git options.
 *
 * Pure: no fs, no exec. Returns errors rather than throwing.
 */
import { join, normalize, isAbsolute, resolve, relative, sep } from 'path';

export interface ResolvedSource {
  cloneUrl: string;
  ref?: string;
  subpath?: string;
}

export type Resolution<T> = { ok: true; value: T } | { ok: false; error: string };

/** The public repo string-sources resolve against. */
export const OFFICIAL_PLUGINS_REPO = 'https://github.com/anthropics/claude-plugins-public.git';

const MAX_NAME_LEN = 64;

/**
 * A plugin name becomes a single directory under the plugins dir, so it is
 * restricted to one path segment of safe characters. `.` and `..` are excluded
 * by the leading-character rule.
 */
export function sanitizePluginName(name: unknown): Resolution<string> {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'Missing name' };
  }
  if (name.length > MAX_NAME_LEN) {
    return { ok: false, error: 'Plugin name is too long' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return {
      ok: false,
      error: 'Plugin name must start alphanumeric and contain only letters, digits, dot, dash or underscore',
    };
  }
  return { ok: true, value: name };
}

/**
 * Resolve the install directory and prove it is an immediate child of the
 * plugins dir. Belt-and-braces alongside sanitizePluginName: if the charset rule
 * is ever loosened, this still refuses to write outside.
 *
 * Uses `path.relative` rather than string-prefix matching. The prefix version
 * hardcoded '/', so on Windows `normalize` produced a backslash target while the
 * prefix still held a forward slash — every install and uninstall returned
 * "escapes the plugins directory" on a shipped build target, and CI could not see
 * it because the tests use posix strings.
 */
export function resolveInstallDir(pluginsDir: string, safeName: string): Resolution<string> {
  const base = resolve(pluginsDir);
  const target = resolve(base, safeName);
  const rel = relative(base, target);

  // A single segment, inside the base: not empty, not an escape, no nesting.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep) || rel.includes('/')) {
    return { ok: false, error: 'Resolved install path escapes the plugins directory' };
  }
  return { ok: true, value: target };
}

/**
 * git supports transports that execute commands — `ext::sh -c …` is the classic
 * one, and `file://` / bare local paths allow pointing at a repo with hostile
 * hooks. Only https remotes are accepted.
 */
export function validateCloneUrl(url: unknown): Resolution<string> {
  if (typeof url !== 'string' || !url) {
    return { ok: false, error: 'Missing clone URL' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Clone URL must be an absolute https URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: `Unsupported git transport: ${parsed.protocol.replace(':', '')}` };
  }
  // A URL carrying credentials would end up on disk in .git/config.
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Clone URL must not embed credentials' };
  }
  return { ok: true, value: parsed.toString() };
}

/**
 * A ref is passed as its own argv element, so it cannot inject a command — but
 * a value beginning with `-` would be parsed by git as an option. Restrict to
 * the ordinary ref charset.
 */
export function validateRef(ref: unknown): Resolution<string | undefined> {
  if (ref === undefined || ref === null || ref === '') return { ok: true, value: undefined };
  if (typeof ref !== 'string') return { ok: false, error: 'ref must be a string' };
  if (ref.length > 128) return { ok: false, error: 'ref is too long' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..')) {
    return { ok: false, error: 'ref contains invalid characters' };
  }
  return { ok: true, value: ref };
}

/** `owner/repo`, optionally `.git`-suffixed. */
export function validateRepo(repo: unknown): Resolution<string> {
  if (typeof repo !== 'string' || !repo) return { ok: false, error: 'Missing repo' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo.replace(/\.git$/, ''))) {
    return { ok: false, error: 'repo must be in owner/name form' };
  }
  return { ok: true, value: repo.replace(/\.git$/, '') };
}

/**
 * A subpath is joined onto a freshly cloned temp dir, so it must stay inside it
 * — `../../..` would otherwise let a marketplace entry move an arbitrary
 * directory into the plugins dir.
 */
export function validateSubpath(subpath: unknown): Resolution<string | undefined> {
  if (subpath === undefined || subpath === null || subpath === '') return { ok: true, value: undefined };
  if (typeof subpath !== 'string') return { ok: false, error: 'path must be a string' };

  // Backslashes are refused outright. Git paths use forward slashes, so a
  // backslash is never legitimate here — and the previous check only looked for
  // '/' separators, so on Windows 'a\..\..\etc' normalised to an escape and was
  // ACCEPTED. Unreachable at the time only because resolveInstallDir failed first;
  // fixing that would have turned it into a live traversal.
  if (subpath.includes('\\')) {
    return { ok: false, error: 'path must use forward slashes' };
  }

  const clean = subpath.replace(/^\.\//, '');
  if (isAbsolute(clean) || /^[A-Za-z]:/.test(clean)) {
    return { ok: false, error: 'path must be relative' };
  }

  // Compare on the posix form so the verdict does not depend on the host OS.
  const normalized = normalize(clean).split(sep).join('/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return { ok: false, error: 'path must not traverse outside the repository' };
  }
  if (normalized === '.' || normalized === '') return { ok: true, value: undefined };
  return { ok: true, value: normalized };
}

export type PluginSource =
  | string
  | { source?: unknown; url?: unknown; repo?: unknown; path?: unknown; ref?: unknown };

/**
 * Resolve a marketplace source into a validated clone plan. Fails closed on any
 * unrecognised shape.
 */
export function resolveSource(source: PluginSource): Resolution<ResolvedSource> {
  // A bare string is a relative path inside the official public repo.
  if (typeof source === 'string') {
    const sub = validateSubpath(source);
    if (!sub.ok) return sub;
    if (!sub.value) return { ok: false, error: 'Missing plugin path' };
    return { ok: true, value: { cloneUrl: OFFICIAL_PLUGINS_REPO, subpath: sub.value } };
  }

  if (!source || typeof source !== 'object') {
    return { ok: false, error: 'Unsupported plugin source' };
  }

  const ref = validateRef(source.ref);
  if (!ref.ok) return ref;

  if (source.source === 'url') {
    const url = validateCloneUrl(source.url);
    if (!url.ok) return url;
    return { ok: true, value: { cloneUrl: url.value, ref: ref.value } };
  }

  if (source.source === 'github') {
    const repo = validateRepo(source.repo);
    if (!repo.ok) return repo;
    return { ok: true, value: { cloneUrl: `https://github.com/${repo.value}.git`, ref: ref.value } };
  }

  if (source.source === 'git-subdir') {
    const url = validateCloneUrl(source.url);
    if (!url.ok) return url;
    const sub = validateSubpath(source.path);
    if (!sub.ok) return sub;
    return { ok: true, value: { cloneUrl: url.value, ref: ref.value, subpath: sub.value } };
  }

  return { ok: false, error: 'Unsupported plugin source' };
}

/**
 * The argv for the clone. Built here so the route never assembles a command
 * string. `--` terminates option parsing so neither the URL nor the target can
 * be read as a flag.
 */
export function buildCloneArgs(plan: ResolvedSource, targetDir: string): string[] {
  const args = ['clone', '--depth', '1', '--single-branch'];
  if (plan.ref) args.push('--branch', plan.ref);
  args.push('--', plan.cloneUrl, targetDir);
  return args;
}
