import { describe, it, expect, afterAll, vi } from 'vitest';
import { promises as fs, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/**
 * Real multipart bodies (built by the platform's FormData) against a real temp
 * home; only os.homedir is redirected.
 */
const HOME = realpathSync(mkdtempSync(path.join(tmpdir(), 'aime-upload-route-')));

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  const patched = { ...actual, homedir: () => HOME };
  return { ...patched, default: patched };
});

const { POST } = await import('./route');

afterAll(async () => {
  await fs.rm(HOME, { recursive: true, force: true });
});

function upload(fields: Record<string, string | Blob>, fileName = 'image.png') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') form.append(k, v);
    else form.append(k, v, fileName);
  }
  const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
  return POST(new NextRequest(req));
}

describe('POST /api/upload', () => {
  it('stores the file under the chat scratch dir and keeps the display name', async () => {
    const res = await upload({ file: new Blob(['first']), chatId: 'chat-1' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('image.png');
    expect(json.size).toBe(5);
    expect(json.path).toBe(path.join(HOME, '.aime', 'scratch', 'chat-1', 'uploads', 'image.png'));
    expect(await fs.readFile(json.path, 'utf-8')).toBe('first');
  });

  // REGRESSION: uploads/<name> was overwritten by the next same-named file.
  it('a second same-named upload gets its own path; the first survives', async () => {
    const res = await upload({ file: new Blob(['second']), chatId: 'chat-1' });
    const json = await res.json();
    expect(path.basename(json.path)).toBe('image-2.png');
    expect(json.name).toBe('image.png');
    const dir = path.dirname(json.path);
    expect(await fs.readFile(path.join(dir, 'image.png'), 'utf-8')).toBe('first');
    expect(await fs.readFile(json.path, 'utf-8')).toBe('second');
  });

  // REGRESSION: chatId went straight into getScratchDir, so `../..` escaped.
  it.each(['../..', '../../../tmp', '.', 'a/b'])('refuses chatId %j and writes nothing', async (chatId) => {
    const res = await upload({ file: new Blob(['x']), chatId }, 'escape.txt');
    expect(res.status).toBe(400);
    expect(existsSync(path.join(HOME, 'escape.txt'))).toBe(false);
    expect(existsSync(path.join(HOME, '.aime', 'escape.txt'))).toBe(false);
  });

  it('requires a file and a chatId, and leaves no staged file behind', async () => {
    expect((await upload({ chatId: 'c' })).status).toBe(400);
    expect((await upload({ file: new Blob(['x']) })).status).toBe(400);
    const incoming = path.join(HOME, '.aime', 'scratch', '.incoming');
    expect(existsSync(incoming) ? await fs.readdir(incoming) : []).toEqual([]);
  });

  it('refuses a request that declares more than the cap', async () => {
    const req = new NextRequest('http://localhost/api/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=xyz',
        'content-length': String(300 * 1024 * 1024),
      },
      body: '--xyz--\r\n',
    });
    expect((await POST(req)).status).toBe(413);
  });

  it('refuses a non-multipart body', async () => {
    const req = new NextRequest('http://localhost/api/upload', { method: 'POST', body: '{}' });
    expect((await POST(req)).status).toBe(400);
  });
});
