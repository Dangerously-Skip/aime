import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/** Real files — the endpoint's whole job is reading and writing VOICE.md. */
const { homeRef } = vi.hoisted(() => ({ homeRef: { value: '' } }));

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => homeRef.value || actual.homedir() };
});

let dir: string;
const voicePath = () => join(dir, '.claude', 'VOICE.md');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-voice-'));
  homeRef.value = dir;
});
afterEach(async () => {
  homeRef.value = '';
  await rm(dir, { recursive: true, force: true });
});

const post = async (body: unknown, raw?: string) => {
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/identity/voice-md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }),
  );
};

const get = async () => {
  const { GET } = await import('./route');
  const res = await GET();
  return { status: res.status, body: await res.json() };
};

describe('GET /api/identity/voice-md', () => {
  it('returns empty when no profile has been saved', async () => {
    expect(await get()).toEqual({ status: 200, body: { content: '', profile: {} } });
  });

  it('returns both the markdown and the parsed profile', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(voicePath(), '# Writing voice\n\n## Tone\n\nDry.\n');

    const { body } = await get();
    expect(body.content).toContain('## Tone');
    expect(body.profile).toEqual({ tone: 'Dry.' });
  });
});

describe('POST /api/identity/voice-md', () => {
  it('saves a structured profile and returns what it parsed back', async () => {
    const res = await post({ profile: { tone: 'Dry and direct.', avoid: 'Semicolons.' } });
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toEqual({ tone: 'Dry and direct.', avoid: 'Semicolons.' });

    const written = await readFile(voicePath(), 'utf-8');
    expect(written).toContain('## Tone');
    expect(written).toContain('## Never do this');
  });

  it('saves raw markdown from a text editor', async () => {
    const res = await post({ content: '## Vocabulary\n\nPlain words.\n' });
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toEqual({ vocabulary: 'Plain words.' });
  });

  it('a structured save can never produce a document the parser cannot read', async () => {
    // Round-tripped through the serializer for exactly this reason.
    await post({ profile: { tone: 'A\n\n## Tone\n\ninjected heading attempt' } });
    const { body } = await get();
    expect(body.profile.tone).toBeTruthy();
    // whatever survived, the document still parses into known sections only
    expect(Object.keys(body.profile).every((k) =>
      ['tone', 'sentence-rhythm', 'vocabulary', 'structure', 'avoid'].includes(k),
    )).toBe(true);
  });

  it('creates the .claude directory when it does not exist', async () => {
    // Fresh install: nothing has written to ~/.claude yet.
    const res = await post({ profile: { tone: 'Dry.' } });
    expect(res.status).toBe(200);
    await expect(readFile(voicePath(), 'utf-8')).resolves.toContain('Dry.');
  });

  it('clearing every section writes an empty document rather than failing', async () => {
    await post({ profile: { tone: 'Dry.' } });
    const res = await post({ profile: {} });
    expect(res.status).toBe(200);
    expect(await readFile(voicePath(), 'utf-8')).toBe('');
    expect((await get()).body.profile).toEqual({});
  });

  it('rejects a body with neither content nor profile', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ profile: 'not an object' })).status).toBe(400);
    expect((await post({ profile: ['a'] })).status).toBe(400);
  });

  it('rejects a non-JSON body', async () => {
    expect((await post(null, 'not json')).status).toBe(400);
  });
});
