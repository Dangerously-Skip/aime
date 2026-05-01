/**
 * Bundled skills that ship with the app.
 * On first launch (or when missing), these are copied to ~/.claude/skills/
 */
import { parseSkillMd, evaluateSkillRequires } from './skill-parser';

export interface BundledSkill {
  id: string;
  name: string;
  description: string;
  files: string[]; // Relative paths within the skill directory
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Evaluate gate requirements for a skill identified by its SKILL.md content.
 * Returns the skill with disabled + disabledReason if gating fails.
 */
export function applySkillGating(skill: BundledSkill, skillMdContent: string): BundledSkill {
  const parsed = parseSkillMd(skillMdContent);
  const gate = evaluateSkillRequires(parsed.frontmatter.requires as Parameters<typeof evaluateSkillRequires>[0]);
  if (gate.disabled) {
    return { ...skill, disabled: true, disabledReason: gate.reason };
  }
  return skill;
}

// IMPORTANT: don't add nib-ppt here. The full nib-ppt plugin is bundled
// via main-web.js's installNibPptPlugin() into ~/.claude/plugins/nib-ppt/,
// which registers the canonical sub-skill `nib-ppt:generate-ppt` along
// with its sibling skills. Adding a competing top-level `nib-ppt` here
// confuses skill matching — Claude tends to read the simpler bundled
// SKILL.md and shell out via Bash directly instead of invoking the
// richer plugin sub-skill via the Skill tool.
export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    id: 'nib-pdf',
    name: 'nib-pdf',
    description: 'Generate professional PDF documents using Python fpdf2',
    files: ['SKILL.md'],
  },
];

/**
 * Install bundled skills by calling the server-side API route.
 * Only installs skills that are not already present.
 */
export async function installBundledSkills(): Promise<void> {
  try {
    const response = await fetch('/api/customize/skills/install-bundled', {
      method: 'POST',
    });
    if (!response.ok) {
      console.error('[BundledSkills] Install failed:', response.status);
    }
  } catch (err) {
    console.error('[BundledSkills] Install error:', err);
  }
}
