/**
 * Bundled skills that ship with the app.
 * On first launch (or when missing), these are copied to ~/.claude/skills/
 */

export interface BundledSkill {
  id: string;
  name: string;
  description: string;
  files: string[]; // Relative paths within the skill directory
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
