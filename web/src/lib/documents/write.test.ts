import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import path from 'path';
import { resolveDocumentTarget, describeOutcome } from './write';
import { resolveContainedChild } from '../path-containment';

describe('resolveDocumentTarget', () => {
  it('turns a human title into a confined filename pair', () => {
    const r = resolveDocumentTarget('/out', 'Q3 Board Pack');
    expect(r.ok && r.target).toMatchObject({
      slug: 'q3-board-pack',
      htmlPath: '/out/q3-board-pack.html',
      pdfPath: '/out/q3-board-pack.pdf',
    });
  });

  it('handles a trailing slash on the base directory', () => {
    const r = resolveDocumentTarget('/out/', 'Report');
    expect(r.ok && r.target.htmlPath).toBe('/out/report.html');
  });

  it('flattens a traversal attempt instead of escaping', () => {
    const r = resolveDocumentTarget('/out', '../../etc/passwd');
    expect(r.ok && r.target.htmlPath).toBe('/out/etc-passwd.html');
  });

  it('refuses a title with nothing usable rather than writing a junk filename', () => {
    for (const title of ['...', '///', '   ', '', undefined, 42]) {
      expect(resolveDocumentTarget('/out', title).ok, String(title)).toBe(false);
    }
  });

  it('property: an accepted target always stays directly inside the base directory', () => {
    fc.assert(
      fc.property(fc.string(), (title) => {
        const r = resolveDocumentTarget('/base', title);
        if (!r.ok) return;
        for (const p of [r.target.htmlPath, r.target.pdfPath]) {
          expect(p.startsWith('/base/')).toBe(true);
          expect(p.slice('/base/'.length)).not.toContain('/');
          expect(p).not.toContain('..');
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('regression: confines a document under a Windows output directory', () => {
    // The containment check here used to be a string-prefix comparison against a
    // '/'-terminated base — the same form that made every plugin install fail on
    // a shipped Windows build. Untestable then, because the module read ambient
    // `path`; the shared helper takes a flavour, so the win32 verdict is asserted
    // on a posix runner.
    const r = resolveDocumentTarget('C:\\Users\\u\\Documents', 'Q3 Board Pack', {
      flavour: path.win32,
    });
    expect(r.ok && r.target).toMatchObject({
      dir: 'C:\\Users\\u\\Documents',
      slug: 'q3-board-pack',
      htmlPath: 'C:\\Users\\u\\Documents\\q3-board-pack.html',
      pdfPath: 'C:\\Users\\u\\Documents\\q3-board-pack.pdf',
    });
  });

  it('the containment check is real, not a tautology over the slug', () => {
    // Both this and resolveSkillDir were only ever fed a slug, which cannot
    // contain a separator — so the guard could not fail and asserted nothing,
    // while reading at the call site as the boundary for a model-chosen filename.
    // Driving the shared helper directly proves the boundary now holds, so the
    // obvious next change (accepting a title that is not slugified first) is safe.
    for (const segment of ['../../etc/passwd', 'a/b', '..', '', 'C:\\Windows']) {
      expect(
        resolveContainedChild('/out', segment, { error: 'nope' }).ok,
        JSON.stringify(segment),
      ).toBe(false);
    }
  });
});

describe('describeOutcome — the model must not claim a PDF that does not exist', () => {
  it('reports a PDF when one was written', () => {
    const msg = describeOutcome({ title: 'R', htmlPath: '/o/r.html', pdfPath: '/o/r.pdf' });
    expect(msg).toContain('/o/r.pdf');
    expect(msg).toContain('PDF');
  });

  it('says HTML only, and why, when printing was unavailable', () => {
    const msg = describeOutcome({ title: 'R', htmlPath: '/o/r.html' });
    expect(msg).toContain('/o/r.html');
    expect(msg).toMatch(/needs the desktop app/);
    // it must not imply a PDF path exists
    expect(msg).not.toContain('.pdf');
  });

  it('reports the reason when printing was attempted and failed', () => {
    const msg = describeOutcome({ title: 'R', htmlPath: '/o/r.html', pdfError: 'out of memory' });
    expect(msg).toContain('out of memory');
    expect(msg).not.toContain('/o/r.pdf');
  });

  it('still tells the user the HTML is usable in the degraded case', () => {
    // Otherwise "no PDF" reads as total failure when a usable document exists.
    expect(describeOutcome({ title: 'R', htmlPath: '/o/r.html' })).toMatch(/prints from any browser/);
  });
});
