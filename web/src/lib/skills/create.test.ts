import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import path from 'path';
import { slugifySkillName, buildSkillMd, resolveSkillDir } from './create';
import { parseSkillMd } from '../skill-parser';

describe('slugifySkillName', () => {
  it('slugifies a human display name rather than rejecting it', () => {
    // A skill name is a display name — "My Weekly Report" is entirely reasonable.
    expect(slugifySkillName('My Weekly Report')).toEqual({ ok: true, slug: 'my-weekly-report' });
    expect(slugifySkillName('Q3 Board Pack!')).toEqual({ ok: true, slug: 'q3-board-pack' });
    expect(slugifySkillName('already-a-slug')).toEqual({ ok: true, slug: 'already-a-slug' });
  });

  it('flattens traversal attempts to something harmless', () => {
    expect(slugifySkillName('../../etc/passwd')).toEqual({ ok: true, slug: 'etc-passwd' });
    expect(slugifySkillName('/absolute/path')).toEqual({ ok: true, slug: 'absolute-path' });
  });

  it('rejects a name with nothing usable left, rather than inventing a folder', () => {
    // Flattening alone can produce an empty or dash-only string.
    for (const n of ['...', '---', '///', '..', '.', '   ', '', '!!!']) {
      expect(slugifySkillName(n).ok, JSON.stringify(n)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    for (const n of [undefined, null, 42, {}, []]) {
      expect(slugifySkillName(n).ok, String(n)).toBe(false);
    }
  });

  it('never starts with a dash or underscore', () => {
    expect(slugifySkillName('-leading')).toEqual({ ok: true, slug: 'leading' });
    expect(slugifySkillName('_leading')).toEqual({ ok: true, slug: 'leading' });
  });

  it('caps the length and does not leave a trailing dash after the cut', () => {
    const r = slugifySkillName('a'.repeat(100));
    expect(r.ok && r.slug.length).toBe(64);
    const r2 = slugifySkillName(`${'a'.repeat(63)} tail`);
    expect(r2.ok && r2.slug.endsWith('-')).toBe(false);
  });

  it('property: an accepted slug is always a single safe path segment', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const r = slugifySkillName(name);
        if (!r.ok) return;
        expect(r.slug).not.toContain('/');
        expect(r.slug).not.toContain('\\');
        expect(r.slug).not.toContain('..');
        expect(r.slug).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
        expect(r.slug.length).toBeLessThanOrEqual(64);
      }),
      { numRuns: 1000 },
    );
  });

  it('property: an accepted slug always resolves inside the skills directory', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const r = slugifySkillName(name);
        if (!r.ok) return;
        const d = resolveSkillDir('/home/u/.claude/skills', r.slug);
        expect(d.ok).toBe(true);
        expect(d.ok && d.dir.startsWith('/home/u/.claude/skills/')).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('buildSkillMd', () => {
  it('round-trips through the real parser', () => {
    const md = buildSkillMd({
      name: 'Weekly Report',
      description: 'Compiles the weekly report',
      body: '# Steps\n\n1. Gather data\n',
    });
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter.name).toBe('Weekly Report');
    expect(parsed.frontmatter.description).toBe('Compiles the weekly report');
    expect(parsed.frontmatter['user-invocable']).toBe(true);
    expect(parsed.body).toContain('1. Gather data');
  });

  it('omits optional keys that were not set', () => {
    const md = buildSkillMd({ name: 'x', body: 'b' });
    expect(md).not.toContain('argument-hint');
    expect(md).not.toContain('allowed-tools');
  });

  it('emits allowed-tools and argument-hint when given', () => {
    const md = buildSkillMd({
      name: 'x',
      body: 'b',
      allowedTools: ['Read', 'Grep'],
      argumentHint: '<report-name>',
    });
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter['allowed-tools']).toEqual(['Read', 'Grep']);
    expect(parsed.frontmatter['argument-hint']).toBe('<report-name>');
  });

  it('supports a model-only skill', () => {
    const md = buildSkillMd({ name: 'x', body: 'b', userInvocable: false });
    expect(parseSkillMd(md).frontmatter['user-invocable']).toBe(false);
  });

  it('tolerates an empty body', () => {
    expect(() => buildSkillMd({ name: 'x', body: '' })).not.toThrow();
  });
});

describe('resolveSkillDir', () => {
  it('resolves an immediate child', () => {
    expect(resolveSkillDir('/s', 'my-skill')).toEqual({ ok: true, dir: '/s/my-skill' });
  });

  it('handles a trailing slash on the base', () => {
    expect(resolveSkillDir('/s/', 'x')).toEqual({ ok: true, dir: '/s/x' });
  });

  it('refuses a nested or escaping slug even though slugify prevents it', () => {
    // Second line of defence, in case the charset is ever loosened. Until the
    // shared containment rule landed this could not fail at all — a slug has no
    // separators, so the guard asserted nothing while reading as the boundary.
    expect(resolveSkillDir('/s', 'a/b').ok).toBe(false);
    expect(resolveSkillDir('/s', '../evil').ok).toBe(false);
    expect(resolveSkillDir('/s', '..').ok).toBe(false);
    expect(resolveSkillDir('/s', '').ok).toBe(false);
    // '..\evil' is one legal filename on Linux and a traversal on Windows; a skill
    // folder written on one host is read on the other, so both refuse it.
    expect(resolveSkillDir('/s', '..\\evil').ok).toBe(false);
  });

  it('regression: resolves a skill under a WINDOWS skills dir', () => {
    // Same string-prefix form that broke every plugin install on a shipped
    // Windows build — this copy still had it, and no test could see it while the
    // module read ambient `path`.
    expect(
      resolveSkillDir('C:\\Users\\u\\.claude\\skills', 'weekly-report', { flavour: path.win32 }),
    ).toEqual({ ok: true, dir: 'C:\\Users\\u\\.claude\\skills\\weekly-report' });
    expect(
      resolveSkillDir('C:\\Users\\u\\.claude\\skills', '..\\evil', { flavour: path.win32 }).ok,
    ).toBe(false);
  });
});
