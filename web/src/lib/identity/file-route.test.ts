import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { identityFileHandlers } from './file-route';

/**
 * GET used to answer "empty" for every read error, so an unreadable SOUL.md
 * looked like no SOUL.md — and the editor could save that emptiness over it.
 * Against a real temp home: only a MISSING file is empty.
 */

let home: string;
let h: ReturnType<typeof identityFileHandlers>;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-identity-'));
  h = identityFileHandlers('SOUL.md', () => home);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const post = (body: unknown) =>
  h.POST(new Request('http://localhost/api/identity/soul-md', { method: 'POST', body: JSON.stringify(body) }));

describe('identity file route', () => {
  it('a missing file is empty, not an error', async () => {
    const res = await h.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ content: '' });
  });

  it('an unreadable file is a 500 that says which file and why', async () => {
    // A DIRECTORY where the file should be: EISDIR on every platform, no /proc tricks.
    fs.mkdirSync(path.join(home, '.claude', 'SOUL.md'), { recursive: true });
    const res = await h.GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Could not read ~/.claude/SOUL.md (EISDIR).');
    expect(body).not.toHaveProperty('content');
  });

  it('round-trips what was saved', async () => {
    expect((await post({ content: 'I am SOUL' })).status).toBe(200);
    expect(await (await h.GET()).json()).toEqual({ content: 'I am SOUL' });
  });

  it('refuses a non-string or malformed body', async () => {
    expect((await post({ content: 42 })).status).toBe(400);
    const bad = await h.POST(new Request('http://localhost/x', { method: 'POST', body: '{nope' }));
    expect(bad.status).toBe(400);
  });

  it('a failed write is a 500 with the reason, not a stack', async () => {
    // A FILE where ~/.claude should be: the mkdir fails with ENOTDIR/EEXIST, instantly.
    fs.writeFileSync(path.join(home, '.claude'), 'not a dir');
    const res = await post({ content: 'x' });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/^Could not write ~\/\.claude\/SOUL\.md \(E[A-Z]+\)\.$/);
  });
});
