import { NextRequest } from 'next/server';
import { join } from 'path';
import { homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { parseVoiceProfile, serializeVoiceProfile, type VoiceProfile } from '@/lib/identity/voice';

/**
 * GET|POST /api/identity/voice-md — the user's writing voice profile (P4).
 *
 * Stored as Markdown beside SOUL.md and USER.md so it can be read and edited in
 * any editor. Accepts either raw Markdown (`content`) from a text editor, or a
 * structured `profile` from the settings form and the generation tool — the two
 * are the same document, so both are supported rather than forcing one shape.
 */

const VOICE_MD_PATH = () => join(homedir(), '.claude', 'VOICE.md');

export const runtime = 'nodejs';

export async function GET() {
  try {
    const content = await readFile(VOICE_MD_PATH(), 'utf-8');
    return Response.json({ content, profile: parseVoiceProfile(content) });
  } catch {
    return Response.json({ content: '', profile: {} });
  }
}

export async function POST(req: NextRequest) {
  let body: { content?: unknown; profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let markdown: string;
  if (typeof body.content === 'string') {
    markdown = body.content;
  } else if (body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile)) {
    // Round-trip through the serializer so a structured save can never produce a
    // document the parser would not read back.
    markdown = serializeVoiceProfile(body.profile as VoiceProfile);
  } else {
    return Response.json({ error: 'Provide content (markdown) or profile (object)' }, { status: 400 });
  }

  try {
    await mkdir(join(homedir(), '.claude'), { recursive: true });
    await writeFile(VOICE_MD_PATH(), markdown, 'utf-8');
    return Response.json({ ok: true, profile: parseVoiceProfile(markdown) });
  } catch (err) {
    console.error('[Identity] VOICE.md write failed:', err);
    return Response.json({ error: 'Could not save the writing voice' }, { status: 500 });
  }
}
