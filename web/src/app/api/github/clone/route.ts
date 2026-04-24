export const runtime = 'nodejs';

import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { readProvisionedGithubToken } from '@/lib/github-token';

const execAsync = promisify(exec);

const REPOS_DIR = join(homedir(), 'Quarry', 'repos');

/**
 * POST /api/github/clone
 * Body: { owner, repo, defaultBranch? }
 * Clones the repo to ~/Quarry/repos/<owner>/<repo>/ using the provisioned
 * GitHub PAT from ~/.claude/.quarry-mcp.json.
 * Returns { path } where path is the absolute local path to the cloned repo.
 */
export async function POST(request: Request) {
  try {
    const { owner, repo, defaultBranch } = await request.json();
    // Always read the PAT server-side — client store holds a sentinel.
    const token = await readProvisionedGithubToken();

    if (!owner || !repo) {
      return Response.json({ error: 'Missing owner or repo' }, { status: 400 });
    }

    // Safety: prevent path traversal
    if (owner.includes('/') || owner.includes('..') || repo.includes('/') || repo.includes('..')) {
      return Response.json({ error: 'Invalid owner or repo name' }, { status: 400 });
    }

    const ownerDir = join(REPOS_DIR, owner);
    const targetDir = join(ownerDir, repo);

    // Already cloned? Just return the path
    try {
      const s = await stat(targetDir);
      if (s.isDirectory()) {
        return Response.json({ path: targetDir, alreadyCloned: true });
      }
    } catch {}

    await mkdir(ownerDir, { recursive: true });

    // Build clone URL — embed the token if provided for private repos
    const cloneUrl = token
      ? `https://oauth2:${token}@github.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

    const branchArg = defaultBranch ? `--branch ${JSON.stringify(defaultBranch)}` : '';

    try {
      await execAsync(
        `git clone --depth 1 ${branchArg} ${JSON.stringify(cloneUrl)} ${JSON.stringify(targetDir)}`,
        { timeout: 120_000 }
      );
    } catch (err) {
      // Clean up any partial clone
      try {
        await execAsync(`rm -rf ${JSON.stringify(targetDir)}`);
      } catch {}
      throw err;
    }

    // After cloning with token-in-URL, rewrite the remote to strip the token from disk
    if (token) {
      try {
        await execAsync(
          `git -C ${JSON.stringify(targetDir)} remote set-url origin https://github.com/${owner}/${repo}.git`
        );
      } catch {}
    }

    return Response.json({ path: targetDir, alreadyCloned: false });
  } catch (error) {
    console.error('[GitHub Clone] Error:', error);
    const message = error instanceof Error ? error.message : 'Clone failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
