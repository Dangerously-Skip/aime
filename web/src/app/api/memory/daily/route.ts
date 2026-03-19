import { NextRequest } from 'next/server';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, appendFile, mkdir } from 'fs/promises';

export const runtime = 'nodejs';

function todayLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(homedir(), '.claude', 'memory', `${date}.md`);
}

export async function GET() {
  try {
    const content = await readFile(todayLogPath(), 'utf-8');
    return Response.json({ content });
  } catch {
    return Response.json({ content: '' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { entry } = await req.json() as { entry: string };
    if (typeof entry !== 'string' || !entry.trim()) {
      return Response.json({ error: 'Entry must be a non-empty string' }, { status: 400 });
    }

    const dir = join(homedir(), '.claude', 'memory');
    await mkdir(dir, { recursive: true });

    const timestamp = new Date().toISOString();
    const formatted = `\n---\n**${timestamp}**\n\n${entry.trim()}\n`;
    await appendFile(todayLogPath(), formatted, 'utf-8');

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
