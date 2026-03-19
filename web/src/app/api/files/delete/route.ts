export const runtime = 'nodejs';

import fs from 'fs';
import path from 'path';

/**
 * POST /api/files/delete
 * Deletes a file from disk. Used by the Artifacts sidebar to remove generated files.
 * Only allows deletion of files inside the provided cowork working directory.
 */
export async function POST(request: Request) {
  try {
    const { path: filePath, cwd } = await request.json();

    if (!filePath || typeof filePath !== 'string') {
      return Response.json({ error: 'Missing path' }, { status: 400 });
    }
    if (!cwd || typeof cwd !== 'string') {
      return Response.json({ error: 'Missing cwd (working directory)' }, { status: 400 });
    }

    const resolvedCwd = path.resolve(cwd);
    const resolved = path.resolve(filePath);

    // Only allow deletion of files within the cowork working directory
    if (!resolved.startsWith(resolvedCwd + '/')) {
      return Response.json({ error: 'File is outside the working directory' }, { status: 403 });
    }

    if (!fs.existsSync(resolved)) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return Response.json({ error: 'Cannot delete directories' }, { status: 400 });
    }

    fs.unlinkSync(resolved);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
