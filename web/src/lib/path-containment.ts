/**
 * One containment check for "this name becomes a single entry directly inside
 * that directory".
 *
 * Three near-identical copies existed — `resolveInstallDir` (mcp/install-guard),
 * `resolveSkillDir` (skills/create) and `resolveDocumentTarget`
 * (documents/write) — and two of them were the string-prefix form this branch
 * had already found broken on Windows:
 *
 *     const base = dir.endsWith('/') ? dir : `${dir}/`;
 *     const target = `${base}${name}`;
 *     if (!target.startsWith(base) || target.slice(base.length).includes('/'))
 *
 * The '/' is hardcoded. On Windows the joined/normalised target held a backslash
 * while the prefix still held a forward slash, so every install and uninstall
 * answered "escapes the plugins directory" on a shipped build target — and CI
 * could not see it, because the tests use posix strings. That is why `flavour`
 * exists here: the check is driven through `path.win32` and `path.posix`
 * explicitly, so the Windows verdict is asserted on a posix runner.
 *
 * The prefix form had a second problem worth naming. Both surviving copies were
 * fed a slug that already excludes separators, so they could not fail — they
 * asserted nothing while reading, at the call site, as the security boundary for
 * a model-controlled filename. This one is a real check, so the boundary holds
 * the first time someone passes an unslugified title.
 *
 * Pure: resolution and string comparison only, no fs.
 */
import nodePath from 'path';

/**
 * The slice of Node's `path` this needs. `path`, `path.win32` and `path.posix`
 * all satisfy it, which is the whole point — see `flavour` below.
 */
export interface PathFlavour {
  resolve(...segments: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(p: string): boolean;
  readonly sep: string;
}

export type Containment =
  | { ok: true; path: string; base: string }
  | { ok: false; error: string };

export const DEFAULT_CONTAINMENT_ERROR = 'Resolved path escapes its base directory';

export interface ContainOptions {
  /** Failure message, so each caller keeps the wording its users already see. */
  error?: string;
  /**
   * Path flavour to reason in. Defaults to the host's.
   *
   * A TEST SEAM, deliberately: the original Windows bug was invisible to CI
   * because the module used ambient `path` and every test string was posix.
   * Passing `path.win32` is the only way to assert the Windows verdict from a
   * posix runner.
   */
  flavour?: PathFlavour;
}

/**
 * Resolve `segment` inside `baseDir` and prove the result is an IMMEDIATE child
 * — not the base itself, not above it, not nested, not on another root.
 *
 * Returns the resolved child path plus the resolved base, so a caller that needs
 * the directory (to `mkdir` it, say) does not resolve it a second time.
 */
export function resolveContainedChild(
  baseDir: unknown,
  segment: unknown,
  opts: ContainOptions = {},
): Containment {
  const p = opts.flavour ?? nodePath;
  const error = opts.error ?? DEFAULT_CONTAINMENT_ERROR;

  if (typeof baseDir !== 'string' || baseDir === '') return { ok: false, error };
  // An empty segment resolves to the base directory itself. The prefix form
  // accepted it and handed back the base — `resolveSkillDir('/s', '')` returned
  // '/s/' — which is not a child of anything.
  if (typeof segment !== 'string' || segment === '') return { ok: false, error };

  // A drive-qualified segment, rejected whatever flavour we were asked to reason
  // in. On Windows `A:` and `C:foo` are DRIVE-RELATIVE: they resolve against that
  // drive's current directory, not against `base`, so the result is not inside it.
  // On posix they are ordinary filenames — which is the divergence itself, found
  // by the cross-flavour property in path-containment.test.ts, shrunk to `A:`.
  // A name the app accepts on macOS and treats as an escape on Windows is
  // the same class of bug as the prefix check that shipped, so both hosts refuse
  // it. `validateSubpath` already applies this rule to git paths.
  if (/^[A-Za-z]:/.test(segment)) return { ok: false, error };

  // A segment is ONE name, so it may not contain a separator of EITHER flavour.
  // Checked on the raw input rather than on the resolved remainder, because
  // resolution normalises a separator away and then the two flavours disagree
  // about the same string: that same property found `" \\"`, which posix
  // keeps as the literal filename `space backslash` while win32 reads the
  // backslash as a separator and normalises it off, leaving the name `space`.
  // Deciding on the raw segment gives one verdict on every host — and a backslash
  // is never legitimate in a slug or a sanitised plugin name anyway, which is the
  // stance install-guard's `validateSubpath` already takes for git paths (there,
  // checking only '/' was a live win32 traversal).
  if (segment.includes('/') || segment.includes('\\')) return { ok: false, error };

  const base = p.resolve(baseDir);
  const target = p.resolve(base, segment);
  const rel = p.relative(base, target);

  // Belt and braces on the resolved form. The remaining ways `target` can fail to
  // be an immediate child of `base`:
  //   ''                    → the base itself ('.', or a trailing separator)
  //   '..' or '..' + sep    → above the base
  //   absolute              → a different root entirely
  //   contains a separator  → nested, so not an immediate child
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${p.sep}`) ||
    p.isAbsolute(rel) ||
    rel.includes('/') ||
    rel.includes('\\')
  ) {
    return { ok: false, error };
  }

  return { ok: true, path: target, base };
}
