export const runtime = 'nodejs';

import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { BUNDLED_SKILLS } from '@/lib/bundled-skills';

const SKILLS_DIR = join(homedir(), '.claude', 'skills');

/**
 * POST /api/customize/skills/install-bundled
 * Copies bundled skills to ~/.claude/skills/ if they don't already exist.
 */
export async function POST() {
  const results: { id: string; status: 'installed' | 'exists' | 'error'; error?: string }[] = [];

  for (const skill of BUNDLED_SKILLS) {
    const skillDir = join(SKILLS_DIR, skill.id);

    try {
      // Check if skill already exists
      try {
        await access(skillDir);
        results.push({ id: skill.id, status: 'exists' });
        continue;
      } catch {
        // Directory doesn't exist — install it
      }

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
