import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseSkillMd, serializeSkillMd, type SkillFrontmatter } from '@/lib/skill-parser';

export const runtime = 'nodejs';

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

function getSkillDir(skillId: string): string {
  // Prevent path traversal
  const safe = path.basename(skillId);
  return path.join(SKILLS_DIR, safe);
}

/**
 * GET /api/customize/skills/:skillId — Read a single skill
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const { skillId } = await params;
  const skillDir = getSkillDir(skillId);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }

  const raw = fs.readFileSync(skillMdPath, 'utf-8');
  const { frontmatter, body } = parseSkillMd(raw);
  const files = fs.readdirSync(skillDir).filter(f => f !== 'SKILL.md');

  return Response.json({
    skill: {
      id: skillId,
      name: frontmatter.name || skillId,
      description: frontmatter.description || '',
      path: skillDir,
      frontmatter,
      content: body,
      files,
    },
  });
}

/**
 * PUT /api/customize/skills/:skillId — Update a skill
 * Body: { frontmatter?, content? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const { skillId } = await params;
  const skillDir = getSkillDir(skillId);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }

  let body: { frontmatter?: SkillFrontmatter; content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Read existing
  const raw = fs.readFileSync(skillMdPath, 'utf-8');
  const existing = parseSkillMd(raw);

  const newFrontmatter = body.frontmatter
    ? { ...existing.frontmatter, ...body.frontmatter }
    : existing.frontmatter;
  const newContent = body.content !== undefined ? body.content : existing.body;

  const skillMd = serializeSkillMd(newFrontmatter, newContent);
  fs.writeFileSync(skillMdPath, skillMd, 'utf-8');

  const files = fs.readdirSync(skillDir).filter(f => f !== 'SKILL.md');

  return Response.json({
    skill: {
      id: skillId,
      name: newFrontmatter.name || skillId,
      description: newFrontmatter.description || '',
      path: skillDir,
      frontmatter: newFrontmatter,
      content: newContent,
      files,
    },
  });
}

/**
 * DELETE /api/customize/skills/:skillId — Remove a skill
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const { skillId } = await params;
  const skillDir = getSkillDir(skillId);

  if (!fs.existsSync(skillDir)) {
    return Response.json({ error: 'Skill not found' }, { status: 404 });
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  return Response.json({ deleted: true });
}
