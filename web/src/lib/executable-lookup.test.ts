import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { executableCandidates } from './executable-lookup';

describe('executableCandidates', () => {
  it('joins the name onto each absolute PATH entry (posix)', () => {
    expect(executableCandidates('node', { PATH: '/usr/bin:/opt/bin/' }, 'darwin')).toEqual([
      '/usr/bin/node',
      '/opt/bin/node',
    ]);
  });

  it('skips empty and relative PATH entries, which mean "cwd" to a shell', () => {
    expect(executableCandidates('node', { PATH: ':.:bin:/usr/bin' }, 'linux')).toEqual([
      '/usr/bin/node',
    ]);
  });

  it('checks an absolute path directly and refuses a relative one with separators', () => {
    expect(executableCandidates('/usr/local/bin/npx', { PATH: '/usr/bin' }, 'darwin')).toEqual([
      '/usr/local/bin/npx',
    ]);
    expect(executableCandidates('../../bin/sh', { PATH: '/usr/bin' }, 'darwin')).toEqual([]);
    expect(executableCandidates('./sh', { PATH: '/usr/bin' }, 'darwin')).toEqual([]);
  });

  it('applies PATHEXT on Windows, and keeps an explicit extension', () => {
    const env = { PATH: 'C:\\Windows\\System32;"C:\\Program Files\\nodejs"', PATHEXT: '.EXE;.CMD' };
    expect(executableCandidates('npx', env, 'win32')).toEqual([
      'C:\\Windows\\System32\\npx.EXE',
      'C:\\Windows\\System32\\npx.CMD',
      'C:\\Program Files\\nodejs\\npx.EXE',
      'C:\\Program Files\\nodejs\\npx.CMD',
    ]);
    expect(executableCandidates('npx.cmd', env, 'win32')[0]).toBe('C:\\Windows\\System32\\npx.cmd');
  });

  it('refuses blank names and control characters', () => {
    for (const bad of ['', '   ', 'sh\u0000', 'sh\nid', 'a\rb']) {
      expect(executableCandidates(bad, { PATH: '/usr/bin' }, 'linux')).toEqual([]);
    }
  });

  it('never yields a candidate outside a PATH directory for a bare name (property)', () => {
    const dirs = ['/usr/bin', '/opt/tools'];
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (name) => {
        for (const c of executableCandidates(name, { PATH: dirs.join(':') }, 'linux')) {
          if (name.trim().startsWith('/')) {
            expect(c).toBe(name.trim());
          } else {
            const dir = c.slice(0, c.lastIndexOf('/'));
            expect(dirs).toContain(dir);
            expect(c.slice(dir.length + 1)).not.toMatch(/\//);
          }
        }
      }),
    );
  });
});
