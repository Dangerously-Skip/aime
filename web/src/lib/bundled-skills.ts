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

export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    id: 'nib-ppt',
    name: 'nib-ppt',
    description: 'Generate professional PowerPoint presentations from natural language',
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
