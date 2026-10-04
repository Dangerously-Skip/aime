export const runtime = 'nodejs';

import { promises as fs } from 'fs';
import { resolveDeletableFile } from '@/lib/security/user-file-access';

/**
 * POST /api/files/delete
 * Deletes a file from disk. Used by the Artifacts sidebar to remove generated files.
 * Only allows deletion of files inside the provided cowork working directory.
 *
 * `cwd` arrives in the request body, so it is itself checked (home/temp only,
 * not a credential location) and both sides are compared as real paths — the
 * old `startsWith(cwd + '/')` accepted any `cwd` the caller cared to name.
 */
export async function POST(request: Request) {
  let body: { path?: unknown; cwd?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { path: filePath, cwd } = body;

  if (!filePath || typeof filePath !== 'string') {
    return Response.json({ error: 'Missing path' }, { status: 400 });
  }
  if (!cwd || typeof cwd !== 'string') {
    return Response.json({ error: 'Missing cwd (working directory)' }, { status: 400 });
  }

  const access = await resolveDeletableFile(filePath, cwd);
  if (!access.ok) {
    return access.reason === 'not-found'
      ? Response.json({ error: 'File not found' }, { status: 404 })
      : Response.json({ error: 'File is outside the working directory' }, { status: 403 });
  }

  try {
    const stat = await fs.lstat(access.path);
    if (stat.isDirectory()) {
      return Response.json({ error: 'Cannot delete directories' }, { status: 400 });
    }
    await fs.unlink(access.path);
    return Response.json({ ok: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    return Response.json({ error: 'Could not delete file' }, { status: 500 });
  }
}
