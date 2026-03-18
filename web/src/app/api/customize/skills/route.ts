import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseSkillMd, serializeSkillMd, type SkillFrontmatter } from '@/lib/skill-parser';

export const runtime = 'nodejs';

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  frontmatter: SkillFrontmatter;
  content: string;
  files: string[];
}

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
}

function scanSkills(): SkillEntry[] {
  ensureSkillsDir();
  const skills: SkillEntry[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const raw = fs.readFileSync(skillMdPath, 'utf-8');
      const { frontmatter, body } = parseSkillMd(raw);

      // List other files in the skill directory
      const allFiles = fs.readdirSync(skillDir).filter(f => f !== 'SKILL.md');

      skills.push({
        id: entry.name,
        name: frontmatter.name || entry.name,
        description: frontmatter.description || '',
        path: skillDir,
        frontmatter,
        content: body,
        files: allFiles,
      });
    } catch (err) {
      console.error(`[Skills] Error reading skill ${entry.name}:`, err);
    }
  }

  return skills;
}

/**
 * GET /api/customize/skills — List all skills from ~/.claude/skills/
 */
export async function GET() {
  const skills = scanSkills();
  return Response.json({ skills });
}

/**
 * POST /api/customize/skills — Create a new skill
 * Body: { name, description?, content }
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; description?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, description, content } = body;
  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  // Sanitize name for directory
  const dirName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  const skillDir = path.join(SKILLS_DIR, dirName);

  if (fs.existsSync(skillDir)) {
    return Response.json({ error: 'Skill directory already exists' }, { status: 409 });
  }

  ensureSkillsDir();
  fs.mkdirSync(skillDir, { recursive: true });

  const frontmatter: SkillFrontmatter = {
    name,
    description: description || '',
    'user-invocable': true,
  };

  const skillMd = serializeSkillMd(frontmatter, content || '');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

  return Response.json({
    skill: {
      id: dirName,
      name,
      description: description || '',
      path: skillDir,
      frontmatter,
      content: content || '',
      files: [],
    },
  }, { status: 201 });
}
