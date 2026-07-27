import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveDocumentTarget, canPrintPdf, describeOutcome } from './write';

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
});

describe('canPrintPdf', () => {
  it('detects a usable bridge', () => {
    expect(canPrintPdf({ printPdf: async () => ({ ok: true }) })).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of [undefined, null, {}, { printPdf: 'no' }, 42]) {
      expect(canPrintPdf(v), String(v)).toBe(false);
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
