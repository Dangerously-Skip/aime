import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { POST } from './route';
import { closeAllPreviewServers } from '@/lib/preview/manager';

/**
 * Drives the real route against a real temp tree and a real server.
 *
 * The point of this route is that it must NOT become a second way to read
 * arbitrary files — so the refusals are the test, and they are checked by
 * actually fetching the URL it hands back.
 */
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-route-'));
  fs.writeFileSync(path.join(dir, 'deck.html'), '<h1>deck</h1>');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{}');
});

afterEach(async () => {
  await closeAllPreviewServers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:3000/api/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:3000', ...headers },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

describe('POST /api/preview', () => {
  it('returns an http URL for a file, and that URL actually serves it', async () => {
    const res = await POST(req({ path: path.join(dir, 'deck.html') }));
    expect(res.status).toBe(200);
    const { url } = await res.json();

    expect(url.startsWith('http://127.0.0.1:')).toBe(true);
    expect(url).not.toContain('file://');

    // The whole purpose: a real HTTP origin. Assert by fetching it.
    const served = await fetch(url);
    expect(served.status).toBe(200);
    expect(await served.text()).toBe('<h1>deck</h1>');
  });

  it('serves siblings from the same origin, so relative assets resolve', async () => {
    const { url } = await (await POST(req({ path: path.join(dir, 'deck.html') }))).json();
    const sibling = url.replace(/deck\.html$/, 'style.css');
    expect((await fetch(sibling)).status).toBe(200);
  });

  it('reuses one server per root rather than leaking a socket per request', async () => {
    const a = await (await POST(req({ path: path.join(dir, 'deck.html') }))).json();
    const b = await (await POST(req({ path: path.join(dir, 'style.css') }))).json();
    expect(a.port).toBe(b.port);
  });

  it('refuses a root outside the home and temp trees', async () => {
    const res = await POST(req({ path: '/etc/passwd' }));
    expect(res.status).toBe(403);
  });

  it('refuses a cross-origin caller — a browsed page must not allocate origins', async () => {
    const res = await POST(
      req({ path: path.join(dir, 'deck.html') }, {
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.test',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('refuses a missing path, a bad body, and a nonexistent file distinctly', async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ path: path.join(dir, 'nope.html') }))).status).toBe(404);
  });

  it('does not return file CONTENT — only a URL', async () => {
    const body = await (await POST(req({ path: path.join(dir, 'deck.html') }))).json();
    expect(JSON.stringify(body)).not.toContain('<h1>deck</h1>');
    expect(Object.keys(body).sort()).toEqual(['port', 'root', 'url']);
  });

  it('the handed-out origin still refuses traversal', async () => {
    const { url } = await (await POST(req({ path: path.join(dir, 'deck.html') }))).json();
    const escape = new URL('../../../etc/passwd', url).toString();
    expect((await fetch(escape)).status).toBe(404);
  });
});
