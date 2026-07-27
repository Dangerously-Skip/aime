/**
 * Creating a skill from a name and a body (P3.7).
 *
 * "Make me a skill and save it" needs two things the codebase already half had:
 * `serializeSkillMd` (tested) to write the file, and a directory name derived
 * from whatever the user or the agent called it.
 *
 * The naming is separated out and tested because it decides a filesystem path.
 * Unlike the install/MCP routes, a skill name is a *human display name* — "My
 * Weekly Report" is entirely reasonable — so it is slugified rather than
 * rejected. That means the slug, not the input, is what must be proven safe:
 * a single path segment, non-degenerate, and starting with something meaningful.
 *
 * Pure: no fs. The caller writes.
 */
import { serializeSkillMd, type SkillFrontmatter } from '../skill-parser';

export type SlugResult = { ok: true; slug: string } | { ok: false; error: string };

const MAX_SLUG_LEN = 64;

/**
 * Turn a display name into a directory name.
 *
 * Everything outside `[a-z0-9_-]` becomes a dash, runs collapse, and edge dashes
 * are trimmed. That already defeats traversal — `../../etc` flattens to `etc` —
 * but flattening alone can also produce nothing usable (`...` → ``), so the
 * result is validated rather than assumed.
 */
export function slugifySkillName(name: unknown): SlugResult {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: 'A skill name is required.' };
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    // A trailing dash can reappear after slicing.
    .replace(/[-_]+$/g, '');

  if (slug === '' || !/^[a-z0-9]/.test(slug)) {
    return {
      ok: false,
      error: 'That name has no letters or digits to make a folder name from.',
    };
  }
  // Belt and braces: the charset makes these impossible, but the assertion is
  // what keeps a future loosening of the charset from becoming a traversal.
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') {
    return { ok: false, error: 'That name cannot be used as a folder name.' };
  }

  return { ok: true, slug };
}

export interface BuildSkillOptions {
  name: string;
  description?: string;
  body: string;
  /** Tools the skill is allowed to use, if it should be restricted. */
  allowedTools?: string[];
  /** False for a skill only the model should invoke. Defaults to true. */
  userInvocable?: boolean;
  /** An argument hint shown for user-invoked skills, e.g. "<report-name>". */
  argumentHint?: string;
}

/**
 * Assemble the SKILL.md contents. Frontmatter keys are only emitted when set, so
 * a generated skill reads like a hand-written one rather than a form dump.
 */
export function buildSkillMd(opts: BuildSkillOptions): string {
  const frontmatter: SkillFrontmatter = {
    name: opts.name,
    description: opts.description || '',
    'user-invocable': opts.userInvocable ?? true,
  };
  if (opts.argumentHint) frontmatter['argument-hint'] = opts.argumentHint;
  if (opts.allowedTools?.length) frontmatter['allowed-tools'] = opts.allowedTools;

  return serializeSkillMd(frontmatter, opts.body ?? '');
}

/**
 * Resolve the directory a skill will be written to, proving it stays an
 * immediate child of the skills directory.
 */
export function resolveSkillDir(
  skillsDir: string,
  slug: string,
): { ok: true; dir: string } | { ok: false; error: string } {
  const base = skillsDir.endsWith('/') ? skillsDir : `${skillsDir}/`;
  const dir = `${base}${slug}`;
  if (!dir.startsWith(base) || dir.slice(base.length).includes('/')) {
    return { ok: false, error: 'Resolved skill path escapes the skills directory.' };
  }
  return { ok: true, dir };
}
