import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

/**
 * The three `/api/files/*` routes against a real temp "home". os.homedir is
 * the only thing mocked; every path check runs on the real filesystem.
 *
 * REGRESSION: `/api/files/read?path=~/.ssh/id_rsa` returned the key — the
 * home-prefix check passed and the empty extension was on the allow-list — and
 * a symlink in a project pointing at it was followed the same way.
 */
const HOME = realpathSync(mkdtempSync(path.join(tmpdir(), 'aime-files-routes-')));

vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>();
  const patched = { ...actual, homedir: () => HOME };
  return { ...patched, default: patched };
});

const { GET: read } = await import('./read/route');
const { GET: search } = await import('./search/route');
const { POST: del } = await import('./delete/route');

const proj = path.join(HOME, 'proj');

beforeAll(async () => {
  await fs.mkdir(path.join(HOME, '.ssh'), { recursive: true });
  await fs.mkdir(proj, { recursive: true });
  await fs.writeFile(path.join(HOME, '.ssh', 'id_rsa'), '-----BEGIN KEY-----');
  await fs.writeFile(path.join(proj, 'notes.md'), '# hi');
  await fs.writeFile(path.join(proj, 'Makefile'), 'all:\n');
  await fs.writeFile(path.join(proj, 'blob'), Buffer.from([1, 0, 2]));
  await fs.symlink(path.join(HOME, '.ssh', 'id_rsa'), path.join(proj, 'innocent.txt'));
});

afterAll(async () => {
  await fs.rm(HOME, { recursive: true, force: true });
});

const readReq = (p: string) =>
  read(new NextRequest(`http://localhost/api/files/read?path=${encodeURIComponent(p)}`));

describe('GET /api/files/read', () => {
  it('reads a text file and an extensionless text file', async () => {
    const res = await readReq(path.join(proj, 'notes.md'));
    expect(res.status).toBe(200);
    expect((await res.json()).content).toBe('# hi');
    expect((await readReq(path.join(proj, 'Makefile'))).status).toBe(200);
  });

  it('refuses ~/.ssh/id_rsa', async () => {
    const res = await readReq(path.join(HOME, '.ssh', 'id_rsa'));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('BEGIN');
  });

  it('refuses a symlink with an allowed extension that points at a key', async () => {
    const res = await readReq(path.join(proj, 'innocent.txt'));
    expect(res.status).toBe(403);
  });

  it('refuses an extensionless binary file', async () => {
    expect((await readReq(path.join(proj, 'blob'))).status).toBe(400);
  });

  it('refuses paths outside home and temp', async () => {
    expect((await readReq('/etc/hosts')).status).toBe(403);
  });
});

describe('GET /api/files/search', () => {
  const searchReq = async (cwd: string) =>
    (
      await (
        await search(
          new NextRequest(`http://localhost/api/files/search?q=&cwd=${encodeURIComponent(cwd)}`),
        )
      ).json()
    ).files as Array<{ name: string }>;

  it('lists files in a project', async () => {
    expect((await searchReq(proj)).map((f) => f.name)).toContain('notes.md');
  });

  it('lists nothing when rooted in a credential dir or outside home', async () => {
    expect(await searchReq(path.join(HOME, '.ssh'))).toEqual([]);
    expect(await searchReq('/etc')).toEqual([]);
  });
});

describe('POST /api/files/delete', () => {
  const delReq = (body: unknown) =>
    del(
      new Request('http://localhost/api/files/delete', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );

  it('refuses a cwd chosen to contain the target', async () => {
    // The old check only asked "is path under cwd" with cwd from the body.
    const res = await delReq({ path: path.join(HOME, '.ssh', 'id_rsa'), cwd: HOME });
    expect(res.status).toBe(403);
    await expect(fs.access(path.join(HOME, '.ssh', 'id_rsa'))).resolves.toBeUndefined();
  });

  it('refuses a file outside the working directory', async () => {
    const res = await delReq({ path: path.join(HOME, '.ssh', 'id_rsa'), cwd: proj });
    expect(res.status).toBe(403);
  });

  it('deletes a symlink without touching its target', async () => {
    const res = await delReq({ path: path.join(proj, 'innocent.txt'), cwd: proj });
    expect(res.status).toBe(200);
    await expect(fs.lstat(path.join(proj, 'innocent.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(HOME, '.ssh', 'id_rsa'))).resolves.toBeUndefined();
  });

  it('deletes a file in the working directory', async () => {
    const res = await delReq({ path: path.join(proj, 'notes.md'), cwd: proj });
    expect(res.status).toBe(200);
    await expect(fs.access(path.join(proj, 'notes.md'))).rejects.toThrow();
  });
});
