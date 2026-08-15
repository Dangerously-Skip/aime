import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { serverForRoot } from '@/lib/preview/manager';
import { isCrossOriginRequest } from '@/lib/security/same-origin';

/**
 * Hand out an `http://127.0.0.1` URL for a local file, so it can be previewed
 * somewhere other than `file://`.
 *
 * See `lib/preview/static-server.ts` for why a null origin is not survivable:
 * YouTube embeds return Error 153, ES modules resolve against the filesystem
 * root, and `fetch`/CORS/service workers refuse outright.
 *
 * This route only ALLOCATES the origin. It never reads or returns file content
 * — that is the preview server's job, on its own port, behind its own
 * containment. Keeping the two apart is what stops this route becoming a second
 * way to read arbitrary files.
 */

/** The root is the file's own directory, so siblings (css, js, images) resolve. */
function rootFor(filePath: string): string {
  return path.dirname(filePath);
}

export async function POST(request: NextRequest) {
  // The app's API is unauthenticated on loopback. A page in the browser surface
  // must not be able to stand up a server rooted wherever it likes.
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = typeof body.path === 'string' ? body.path : '';
  if (!raw) return Response.json({ error: 'path required' }, { status: 400 });

  const resolved = path.resolve(raw);

  /*
   * The same subtree rule `/api/files/read` uses. This is a coarse gate, not the
   * containment: the preview server confines every request to the root it was
   * given. What this stops is that root being chosen as `/` or `/etc` in the
   * first place, which no containment below could recover from.
   */
  const home = os.homedir();
  const inAllowedTree =
    resolved === home ||
    resolved.startsWith(home + path.sep) ||
    resolved.startsWith('/tmp' + path.sep) ||
    resolved.startsWith(os.tmpdir() + path.sep);
  if (!inAllowedTree) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const isDir = stat.isDirectory();
  if (!isDir && !stat.isFile()) {
    return Response.json({ error: 'Not a file' }, { status: 400 });
  }

  const root = isDir ? resolved : rootFor(resolved);
  const server = await serverForRoot(root);
  const url = isDir ? `${server.baseUrl}/` : server.urlFor(resolved);

  if (!url) {
    // urlFor refuses anything outside the root; reaching here would mean the
    // root and the file disagree, which is a bug rather than a user error.
    return Response.json({ error: 'Could not map that path' }, { status: 500 });
  }

  return Response.json({ url, root, port: server.port });
}
