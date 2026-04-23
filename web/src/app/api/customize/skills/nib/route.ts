export const runtime = 'nodejs';

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parseSkillMd } from '@/lib/skill-parser';

const REPO_OWNER = 'redacted-org';
const REPO_NAME = 'nib-skills';
const REPO_BRANCH = 'master';
const SKILLS_PATH_PREFIX = 'skills/';
const SKILLS_DIR = join(homedir(), '.claude', 'skills');

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

async function fetchTree(token: string): Promise<TreeEntry[]> {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_BRANCH}?recursive=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub tree fetch failed (${res.status})`);
  }
  const data = await res.json();
  return (data.tree || []) as TreeEntry[];
}

async function fetchRawFile(token: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
  return res.text();
}

/**
 * GET /api/customize/skills/nib
 * Lists nib skills from redacted-org/nib-skills. Requires GitHub token in x-github-token header.
 */
export async function GET(request: Request) {
  const token = request.headers.get('x-github-token');
  if (!token) {
    return Response.json({ error: 'GitHub not connected' }, { status: 401 });
  }

  let tree: TreeEntry[];
  try {
    tree = await fetchTree(token);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to load nib skills' },
      { status: 502 }
    );
  }

  // Collect unique skill IDs (first segment under skills/)
  const skillIds = new Set<string>();
  for (const entry of tree) {
    if (!entry.path.startsWith(SKILLS_PATH_PREFIX)) continue;
    const rest = entry.path.slice(SKILLS_PATH_PREFIX.length);
    const id = rest.split('/')[0];
    if (id) skillIds.add(id);
  }

  // Fetch each SKILL.md in parallel to get name/description
  const skills = await Promise.all(
    Array.from(skillIds).map(async (id) => {
      const skillMdPath = `${SKILLS_PATH_PREFIX}${id}/SKILL.md`;
      const hasSkillMd = tree.some((e) => e.path === skillMdPath && e.type === 'blob');
      if (!hasSkillMd) return null;

      let name = id;
      let description = '';
      try {
        const raw = await fetchRawFile(token, skillMdPath);
        const { frontmatter } = parseSkillMd(raw);
        name = frontmatter.name || id;
        description = frontmatter.description || '';
      } catch {
        // Fall back to id/empty description
      }

      return {
        id,
        name,
        description,
        installed: existsSync(join(SKILLS_DIR, id)),
      };
    })
  );

  const filtered = skills.filter((s): s is NonNullable<typeof s> => s !== null);
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ skills: filtered });
}
