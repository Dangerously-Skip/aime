import 'server-only';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';

/**
 * GET/POST for one identity file in ~/.claude (USER.md, SOUL.md).
 *
 * GET used to answer `{ content: '' }` on ANY read error. For a missing file
 * that is right — nothing written yet — but a permission error or an
 * unreadable file then looked exactly like "empty", and the editor would save
 * that emptiness over the real file. Now only ENOENT reads as empty; anything
 * else is a 500 with a message the editor shows.
 *
 * `home` is resolved per request (not at import) so a test can point it at a
 * temp directory.
 */
export function identityFileHandlers(fileName: string, home: () => string = homedir) {
  const filePath = () => join(home(), '.claude', fileName);

  async function GET(): Promise<Response> {
    try {
      return Response.json({ content: await readFile(filePath(), 'utf-8') });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return Response.json({ content: '', exists: false });
      console.error(`[IDENTITY] Could not read ${fileName}:`, err instanceof Error ? err.message : err);
      return Response.json(
        { error: `Could not read ~/.claude/${fileName}${code ? ` (${code})` : ''}.` },
        { status: 500 },
      );
    }
  }

  async function POST(req: Request): Promise<Response> {
    let content: unknown;
    try {
      ({ content } = (await req.json()) as { content?: unknown });
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof content !== 'string') {
      return Response.json({ error: 'Content must be a string' }, { status: 400 });
    }
    try {
      await mkdir(join(home(), '.claude'), { recursive: true });
      await writeFile(filePath(), content, 'utf-8');
      return Response.json({ ok: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      console.error(`[IDENTITY] Could not write ${fileName}:`, err instanceof Error ? err.message : err);
      return Response.json(
        { error: `Could not write ~/.claude/${fileName}${code ? ` (${code})` : ''}.` },
        { status: 500 },
      );
    }
  }

  return { GET, POST };
}
