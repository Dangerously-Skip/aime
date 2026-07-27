import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import path from 'path';
import {
  resolveContainedChild,
  DEFAULT_CONTAINMENT_ERROR,
  type PathFlavour,
} from './path-containment';

/**
 * The string-prefix containment check the three call sites used to share, kept
 * here verbatim so the Windows failure it caused is asserted rather than
 * described. `resolveInstallDir` was the copy that shipped broken; the other two
 * were byte-for-byte the same shape.
 */
function legacyPrefixContainment(dir: string, name: string, p: PathFlavour): boolean {
  const base = dir.endsWith('/') ? dir : `${dir}/`;
  // The real install copy went through path.join/normalize; the skills and
  // documents copies concatenated. Both compared against a '/'-terminated prefix.
  const target = p.resolve(dir, name);
  return target.startsWith(base) && !target.slice(base.length).includes('/');
}

describe('resolveContainedChild — the posix cases the old form already handled', () => {
  it('resolves an immediate child', () => {
    expect(resolveContainedChild('/home/u/.claude/plugins', 'github-mcp')).toEqual({
      ok: true,
      path: '/home/u/.claude/plugins/github-mcp',
      base: '/home/u/.claude/plugins',
    });
  });

  it('does not care whether the base has a trailing separator', () => {
    const withSlash = resolveContainedChild('/s/', 'x');
    const without = resolveContainedChild('/s', 'x');
    expect(withSlash).toEqual(without);
    expect(withSlash.ok && withSlash.path).toBe('/s/x');
  });

  it('refuses escapes, nesting and the base itself', () => {
    for (const segment of [
      '..',
      '../evil',
      '../../etc',
      'a/b',
      'a/../../b',
      './',
      '.',
      '',
      '/etc/passwd',
    ]) {
      expect(resolveContainedChild('/base', segment).ok, JSON.stringify(segment)).toBe(false);
    }
  });

  it('refuses a non-string segment or base rather than coercing it', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(resolveContainedChild('/base', bad).ok, String(bad)).toBe(false);
      expect(resolveContainedChild(bad, 'x').ok, String(bad)).toBe(false);
    }
  });

  it('returns the caller\'s wording, so each surface keeps its own message', () => {
    expect(resolveContainedChild('/s', '../x', { error: 'nope' })).toEqual({
      ok: false,
      error: 'nope',
    });
    expect(resolveContainedChild('/s', '../x')).toEqual({
      ok: false,
      error: DEFAULT_CONTAINMENT_ERROR,
    });
  });
});

describe('regression: containment on Windows (the bug CI could not see)', () => {
  const WIN_PLUGINS = 'C:\\Users\\u\\.claude\\plugins';

  it('accepts a plain child of a Windows directory', () => {
    // THE REGRESSION. On a shipped Windows build every install and uninstall
    // answered "escapes the plugins directory" for an ordinary plugin name,
    // because the target held backslashes and the prefix held a forward slash.
    expect(resolveContainedChild(WIN_PLUGINS, 'github-mcp', { flavour: path.win32 })).toEqual({
      ok: true,
      path: 'C:\\Users\\u\\.claude\\plugins\\github-mcp',
      base: WIN_PLUGINS,
    });
  });

  it('and the old prefix form rejected exactly that, which is the bug', () => {
    // Pins the failure the new implementation fixes. If this ever starts
    // returning true, the regression test above has stopped testing anything.
    expect(legacyPrefixContainment(WIN_PLUGINS, 'github-mcp', path.win32)).toBe(false);
    // The same call on posix passed, which is why it shipped.
    expect(legacyPrefixContainment('/home/u/.claude/plugins', 'github-mcp', path.posix)).toBe(true);
  });

  it('still refuses escapes when reasoning in win32', () => {
    for (const segment of [
      '..\\evil',
      '..\\..\\Windows\\System32',
      'a\\b',
      'C:\\Windows',
      'D:\\elsewhere',
      '..',
      '../evil',
      'a/b',
    ]) {
      expect(
        resolveContainedChild(WIN_PLUGINS, segment, { flavour: path.win32 }).ok,
        JSON.stringify(segment),
      ).toBe(false);
    }
  });

  it('refuses a backslash segment on POSIX too, because it is a win32 escape', () => {
    // '..\\evil' is one legal filename on Linux and a traversal on Windows. The
    // same config, skill or document name can be written on one and read on the
    // other, so the verdict must not depend on which host asked.
    expect(resolveContainedChild('/plugins', '..\\evil', { flavour: path.posix }).ok).toBe(false);
    expect(resolveContainedChild('/plugins', 'a\\b', { flavour: path.posix }).ok).toBe(false);
  });

  it('refuses a drive-qualified name on both flavours', () => {
    // Found by the cross-flavour property below, shrunk to 'A:'. On Windows a
    // drive-qualified segment is DRIVE-RELATIVE — it resolves against that
    // drive's current directory, so the result is not inside the base at all —
    // while on posix it is an ordinary filename. One verdict on both hosts.
    for (const segment of ['A:', 'C:', 'A:evil', 'c:foo']) {
      for (const [flavour, base] of [
        [path.posix, '/base'],
        [path.win32, 'C:\\base'],
      ] as const) {
        expect(resolveContainedChild(base, segment, { flavour }).ok, segment).toBe(false);
      }
    }
  });

  it('refuses a trailing separator on both flavours', () => {
    // Also found by the property, shrunk to ' \\'. posix keeps that as the literal
    // two-character filename; win32 reads the backslash as a separator and
    // normalises it away, leaving the one-character name ' '. Deciding on the raw
    // segment is what makes the two agree.
    for (const segment of [' \\', 'a\\', 'a/', 'a\\\\']) {
      for (const [flavour, base] of [
        [path.posix, '/base'],
        [path.win32, 'C:\\base'],
      ] as const) {
        expect(
          resolveContainedChild(base, segment, { flavour }).ok,
          JSON.stringify(segment),
        ).toBe(false);
      }
    }
  });

  it('gives the same verdict on both flavours for every generated name', () => {
    fc.assert(
      fc.property(fc.string(), (segment) => {
        const posix = resolveContainedChild('/base', segment, { flavour: path.posix }).ok;
        const win32 = resolveContainedChild('C:\\base', segment, { flavour: path.win32 }).ok;
        // Divergence here is precisely the class of bug that shipped: a name the
        // app accepts on macOS and refuses on Windows, or the reverse.
        expect(win32, JSON.stringify(segment)).toBe(posix);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('property: an accepted segment is always an immediate child', () => {
  for (const [name, flavour, base] of [
    ['posix', path.posix, '/base'],
    ['win32', path.win32, 'C:\\base'],
  ] as const) {
    it(`holds on ${name}`, () => {
      fc.assert(
        fc.property(fc.string(), (segment) => {
          const r = resolveContainedChild(base, segment, { flavour });
          if (!r.ok) return;
          // The child is the base plus exactly one separator plus one name.
          expect(r.path.startsWith(base + flavour.sep)).toBe(true);
          const tail = r.path.slice((base + flavour.sep).length);
          expect(tail).not.toBe('');
          expect(tail).not.toContain('/');
          expect(tail).not.toContain('\\');
          expect(tail).not.toBe('..');
        }),
        { numRuns: 2000 },
      );
    });
  }
});
