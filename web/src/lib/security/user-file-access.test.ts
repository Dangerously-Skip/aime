import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isCredentialPath,
  isWithin,
  resolveUserPath,
  resolveDeletableFile,
} from './user-file-access';

/**
 * Real directories and real symlinks in a temp tree:
 *
 *   <root>/home            ← the "home" root
 *   <root>/homeX           ← a sibling whose name has home as a string prefix
 *   <root>/home/.ssh/id_rsa
 *   <root>/home/proj/ok.txt
 *   <root>/home/proj/key   → symlink to ../.ssh/id_rsa
 *   <root>/home/proj/out   → symlink to ../../homeX/secret.txt
 */
let root: string;
let home: string;
let opts: { home: string; roots: string[] };

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aime-ufa-')));
  home = path.join(root, 'home');
  opts = { home, roots: [home] };
  await fs.mkdir(path.join(home, '.ssh'), { recursive: true });
  await fs.mkdir(path.join(home, 'proj'), { recursive: true });
  await fs.mkdir(path.join(home, '.aws'), { recursive: true });
  await fs.mkdir(path.join(home, '.config', 'gcloud'), { recursive: true });
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(home, '.aime'), { recursive: true });
  await fs.mkdir(path.join(root, 'homeX'), { recursive: true });
  await fs.writeFile(path.join(home, '.ssh', 'id_rsa'), 'PRIVATE');
  await fs.writeFile(path.join(home, '.aws', 'credentials'), 'AWS');
  await fs.writeFile(path.join(home, '.config', 'gcloud', 'creds.json'), '{}');
  await fs.writeFile(path.join(home, '.netrc'), 'machine x');
  await fs.writeFile(path.join(home, '.claude', '.aime-mcp.json'), '{}');
  await fs.writeFile(path.join(home, '.claude', '.aime-mcp.corrupt-1.json'), '{}');
  await fs.writeFile(path.join(home, '.aime', 'credentials.enc'), 'x');
  await fs.writeFile(path.join(home, '.bashrc'), 'export A=1');
  await fs.writeFile(path.join(home, 'proj', 'ok.txt'), 'hello');
  await fs.writeFile(path.join(root, 'homeX', 'secret.txt'), 'other user');
  await fs.symlink(path.join('..', '.ssh', 'id_rsa'), path.join(home, 'proj', 'key'));
  await fs.symlink(path.join('..', '..', 'homeX', 'secret.txt'), path.join(home, 'proj', 'out'));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('isWithin', () => {
  it('uses path segments, not string prefixes', () => {
    expect(isWithin('/Users/adam', '/Users/adam/x')).toBe(true);
    expect(isWithin('/Users/adam', '/Users/adam')).toBe(true);
    expect(isWithin('/Users/adam', '/Users/adamX/x')).toBe(false);
    expect(isWithin('/Users/adam', '/Users/adam/../eve')).toBe(false);
  });
});

describe('isCredentialPath', () => {
  it.each([
    '.ssh/id_rsa',
    '.SSH/id_rsa',
    '.aws/credentials',
    '.gnupg/private-keys-v1.d/x',
    '.config/gcloud/application_default_credentials.json',
    '.kube/config',
    '.docker/config.json',
    '.netrc',
    '.npmrc',
    'Library/Keychains/login.keychain-db',
    '.claude/.aime-mcp.json',
    '.claude/.quarry-mcp.json',
    '.claude/.aime-mcp.corrupt-123.json',
    '.claude/.aime-mcp-clients.json',
    '.aime/credentials.enc',
    '.quarry/credentials.enc',
  ])('refuses ~/%s', (rel) => {
    expect(isCredentialPath(path.join('/h', rel), '/h')).toBe(true);
  });

  it.each(['proj/a.ts', '.bashrc', '.docker/other.json', '.config/nvim/init.lua', '.aime/scratch/c/x.png'])(
    'allows ~/%s',
    (rel) => {
      expect(isCredentialPath(path.join('/h', rel), '/h')).toBe(false);
    },
  );
});

describe('resolveUserPath (real fs)', () => {
  it('allows an ordinary file and returns its real path', async () => {
    expect(await resolveUserPath(path.join(home, 'proj', 'ok.txt'), opts)).toEqual({
      ok: true,
      path: path.join(home, 'proj', 'ok.txt'),
    });
    expect((await resolveUserPath(path.join(home, '.bashrc'), opts)).ok).toBe(true);
  });

  it('refuses a sibling directory whose name has home as a prefix', async () => {
    expect(await resolveUserPath(path.join(root, 'homeX', 'secret.txt'), opts)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('refuses a symlink inside home that points outside it', async () => {
    expect((await resolveUserPath(path.join(home, 'proj', 'out'), opts)).ok).toBe(false);
  });

  it('refuses a symlink inside home that points into ~/.ssh', async () => {
    expect((await resolveUserPath(path.join(home, 'proj', 'key'), opts)).ok).toBe(false);
  });

  it.each([
    '.ssh/id_rsa',
    '.aws/credentials',
    '.config/gcloud/creds.json',
    '.netrc',
    '.claude/.aime-mcp.json',
    '.claude/.aime-mcp.corrupt-1.json',
    '.aime/credentials.enc',
  ])('refuses credential file ~/%s', async (rel) => {
    expect(await resolveUserPath(path.join(home, ...rel.split('/')), opts)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('refuses dot-dot traversal out of home', async () => {
    const p = path.join(home, 'proj', '..', '..', 'homeX', 'secret.txt');
    expect((await resolveUserPath(p, opts)).ok).toBe(false);
  });

  it('reports a missing file as not-found and rejects junk input', async () => {
    expect(await resolveUserPath(path.join(home, 'nope'), opts)).toEqual({ ok: false, reason: 'not-found' });
    expect((await resolveUserPath('', opts)).ok).toBe(false);
    expect((await resolveUserPath('a\0b', opts)).ok).toBe(false);
    expect((await resolveUserPath(42, opts)).ok).toBe(false);
  });
});

describe('resolveDeletableFile (real fs)', () => {
  const cwd = () => path.join(home, 'proj');

  it('allows a file inside the working directory', async () => {
    expect(await resolveDeletableFile(path.join(cwd(), 'ok.txt'), cwd(), opts)).toEqual({
      ok: true,
      path: path.join(cwd(), 'ok.txt'),
    });
  });

  it('targets the symlink itself, not what it points at', async () => {
    const r = await resolveDeletableFile(path.join(cwd(), 'key'), cwd(), opts);
    expect(r).toEqual({ ok: true, path: path.join(cwd(), 'key') });
  });

  it('refuses a path outside the working directory', async () => {
    expect((await resolveDeletableFile(path.join(home, '.bashrc'), cwd(), opts)).ok).toBe(false);
    expect((await resolveDeletableFile('../.bashrc', cwd(), opts)).ok).toBe(false);
  });

  it('refuses a working directory outside the roots or inside a credential dir', async () => {
    const other = path.join(root, 'homeX');
    expect((await resolveDeletableFile(path.join(other, 'secret.txt'), other, opts)).ok).toBe(false);
    const ssh = path.join(home, '.ssh');
    expect((await resolveDeletableFile(path.join(ssh, 'id_rsa'), ssh, opts)).ok).toBe(false);
    expect((await resolveDeletableFile(path.join(home, '.ssh', 'id_rsa'), home, opts)).ok).toBe(false);
  });

  it('refuses the working directory itself', async () => {
    expect((await resolveDeletableFile(cwd(), cwd(), opts)).ok).toBe(false);
  });
});
