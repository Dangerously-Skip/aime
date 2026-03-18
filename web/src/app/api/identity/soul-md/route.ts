import { NextRequest } from 'next/server';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';

const SOUL_MD_PATH = join(homedir(), '.claude', 'SOUL.md');

export const runtime = 'nodejs';

export async function GET() {
  try {
    const content = await readFile(SOUL_MD_PATH, 'utf-8');
    return Response.json({ content });
  } catch {
    return Response.json({ content: '' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { content } = await req.json() as { content: string };
    if (typeof content !== 'string') {
      return Response.json({ error: 'Content must be a string' }, { status: 400 });
    }
    await mkdir(join(homedir(), '.claude'), { recursive: true });
    await writeFile(SOUL_MD_PATH, content, 'utf-8');
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
