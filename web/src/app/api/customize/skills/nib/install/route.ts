export const runtime = 'nodejs';

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

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
  if (!res.ok) throw new Error(`GitHub tree fetch failed (${res.status})`);
  const data = await res.json();
  return (data.tree || []) as TreeEntry[];
}

async function fetchBlob(token: string, path: string): Promise<ArrayBuffer> {
  const url = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
  return res.arrayBuffer();
}

/**
 * POST /api/customize/skills/nib/install
 * Body: { skillId }
 * Downloads the skill directory from redacted-org/nib-skills and writes it to ~/.claude/skills/<skillId>/.
 * Existing files are overwritten so install doubles as "update".
 */
export async function POST(request: Request) {
  const token = request.headers.get('x-github-token');
  if (!token) {
    return Response.json({ error: 'GitHub not connected' }, { status: 401 });
  }

  let body: { skillId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const skillId = body.skillId;
  if (!skillId || typeof skillId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(skillId)) {
    return Response.json({ error: 'Invalid skillId' }, { status: 400 });
  }

  const skillPrefix = `${SKILLS_PATH_PREFIX}${skillId}/`;
  const destRoot = join(SKILLS_DIR, skillId);

  let tree: TreeEntry[];
  try {
    tree = await fetchTree(token);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to load nib-skills tree' },
      { status: 502 }
    );
  }

  const blobs = tree.filter((e) => e.type === 'blob' && e.path.startsWith(skillPrefix));
  if (blobs.length === 0) {
    return Response.json({ error: `Skill "${skillId}" not found in nib-skills` }, { status: 404 });
  }

  await mkdir(destRoot, { recursive: true });

  let installedCount = 0;
  const errors: string[] = [];

  // Download in parallel — nib-ship has ~40 files, still well under GitHub's rate limit.
  await Promise.all(
    blobs.map(async (blob) => {
      const relativePath = blob.path.slice(skillPrefix.length);
      const destPath = join(destRoot, relativePath);
      try {
        const buf = await fetchBlob(token, blob.path);
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, Buffer.from(buf));
        installedCount += 1;
      } catch (err) {
        errors.push(`${relativePath}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    })
  );

  if (errors.length > 0 && installedCount === 0) {
    return Response.json(
      { error: `Install failed:\n${errors.join('\n')}` },
      { status: 502 }
    );
  }

  return Response.json({ ok: true, filesInstalled: installedCount, errors });
}
