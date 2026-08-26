import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A desktop app must not fetch its own assets from someone else's server.
 *
 * `code-renderer` loaded highlight.js stylesheets from `cdn.jsdelivr.net` at
 * runtime — "so we don't have to bundle two themes", per the comment it shipped
 * with. On the web that is a reasonable trade. In an Electron app it means
 * syntax highlighting silently degrades to unstyled text with no network, and a
 * request to a third party every time the user switches theme. The files were
 * already in `node_modules` the whole time.
 *
 * `pdf.worker.min.mjs` had the same problem and was solved by copying it to
 * `public/` in `postinstall`; this does the same, and this test is what stops
 * the next one being written the easy way.
 */

const CDN = /https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh)\//;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(full);
  }
  return out;
}

describe('assets are served locally, not from a CDN', () => {
  it('no source file loads a runtime asset from a CDN', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles(path.resolve(process.cwd(), 'src'))) {
      /*
       * Comments are stripped because the note recording WHY necessarily quotes
       * the URL it replaced — but carefully. The obvious `//.*` also eats the
       * `//` in `https://`, which made the first version of this test pass
       * against every CDN URL in the tree, including one it was looking straight
       * at. A line comment must not be preceded by a colon.
       */
      const code = fs
        .readFileSync(f, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*/gm, '$1');
      if (CDN.test(code)) offenders.push(path.relative(process.cwd(), f));
    }
    expect(offenders, 'these fetch assets from a third party at runtime').toEqual([]);
  });

  /**
   * The stylesheets have to actually be there. Pointing at `/hljs/...` without
   * copying them turns a CDN dependency into a 404 — worse, because it fails
   * even WITH a network.
   */
  it.each(['public/hljs/github.css', 'public/hljs/github-dark.css'])('%s exists', (rel) => {
    const p = path.resolve(process.cwd(), rel);
    expect(fs.existsSync(p), `${rel} is referenced but not present`).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toContain('.hljs');
  });

  /** And are replaced on a fresh clone, where `public/` may not carry them. */
  it('postinstall copies them, so a fresh clone works', () => {
    // The hook delegates to scripts/postinstall.js (a cross-platform fs.*
    // copy — the old shell chain ran `cp`/`mkdir -p` through cmd.exe and
    // killed `npm ci` on the Windows release runner). The copies live THERE
    // now, so that is what this asserts.
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    expect(pkg.scripts.postinstall).toMatch(/node scripts\/postinstall\.js/);
    const script = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/postinstall.js'),
      'utf-8',
    );
    expect(script).toContain('highlight.js');
    expect(script).toContain('github.css');
    expect(script).toContain('github-dark.css');
    expect(script).toContain('pdf.worker.min.mjs');
  });

  it('the renderer points at the local copies', () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/shared/file-renderers/code-renderer.tsx'),
      'utf-8',
    );
    expect(src).toContain('/hljs/github.css');
    expect(src).toContain('/hljs/github-dark.css');
  });
});
