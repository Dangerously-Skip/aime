export const runtime = 'nodejs';

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { BUNDLED_SKILLS } from '@/lib/bundled-skills';

const SKILLS_DIR = join(homedir(), '.claude', 'skills');

// Skills that used to be bundled here but have moved to the System 1
// plugin path (~/.claude/plugins/<plugin>/skills/<skill>) or been
// retired. We delete these on each install so existing users don't keep
// stale duplicates that confuse skill matching.
const OBSOLETE_SKILL_IDS = ['nib-ppt'];

/**
 * POST /api/customize/skills/install-bundled
 * Copies bundled skills to ~/.claude/skills/ if they don't already exist.
 */
export async function POST() {
  const results: { id: string; status: 'installed' | 'exists' | 'error' | 'removed'; error?: string }[] = [];

  // Clean up obsolete bundled skills first so registry stays canonical.
  for (const id of OBSOLETE_SKILL_IDS) {
    const dir = join(SKILLS_DIR, id);
    try {
      await rm(dir, { recursive: true, force: true });
      results.push({ id, status: 'removed' });
    } catch (err) {
      console.warn(`[BundledSkills] Failed to remove obsolete ${id}:`, err);
    }
  }

  for (const skill of BUNDLED_SKILLS) {
    const skillDir = join(SKILLS_DIR, skill.id);

    try {
      // Always overwrite — the bundled-skills set is app-curated and
      // ships fixes (e.g. wording corrections to a SKILL.md that misled
      // the model). Existing installs need to receive those updates each
      // launch. Mirrors the force-recopy pattern in main-web.js's
      // installBundledSkills() for the plugin path.
      await mkdir(skillDir, { recursive: true });

      // Copy each file from bundled-skills
      for (const file of skill.files) {
        const sourcePath = join(process.cwd(), 'public', 'bundled-skills', skill.id, file);
        const destPath = join(skillDir, file);

        try {
          const content = await readFile(sourcePath, 'utf-8');
          await writeFile(destPath, content, 'utf-8');
        } catch (err) {
          console.error(`[BundledSkills] Failed to copy ${file} for ${skill.id}:`, err);
        }
      }

      results.push({ id: skill.id, status: 'installed' });
    } catch (err) {
      results.push({
        id: skill.id,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return Response.json({ results });
}
