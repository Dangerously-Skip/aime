import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import fc from 'fast-check';

const require = createRequire(import.meta.url);
const { resolveOpenPath } = require('./open-path-policy.js');

/**
 * What `electronAPI.openPath` may hand to shell.openPath, which RUNS an
 * executable. Checked against a real temp directory, not a stubbed `exists`.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-open-path-'));
const page = path.join(dir, 'index.html');
fs.writeFileSync(page, '<p>hi</p>');
const script = path.join(dir, 'run-me');
fs.writeFileSync(script, '#!/bin/sh\necho hi\n', { mode: 0o755 });
fs.chmodSync(script, 0o755);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const env = {
  homedir: dir,
  platform: 'darwin',
  exists: (p) => fs.existsSync(p),
  isExecutableFile: (p) => {
    const st = fs.statSync(p);
    return st.isFile() && (st.mode & 0o111) !== 0;
  },
};

describe('resolveOpenPath', () => {
  it('opens an existing absolute file, and the folder around it', () => {
    expect(resolveOpenPath(page, env)).toEqual({ ok: true, path: page });
    expect(resolveOpenPath(dir, env)).toEqual({ ok: true, path: dir });
  });

  it('accepts the file:// URL the preview panel holds', () => {
    expect(resolveOpenPath(pathToFileURL(page).href, env)).toEqual({ ok: true, path: page });
  });

  it('expands ~/', () => {
    expect(resolveOpenPath('~/index.html', env)).toEqual({ ok: true, path: page });
  });

  it('refuses relative paths, other URL schemes, empties and NUL bytes', () => {
    for (const bad of ['index.html', './index.html', 'https://example.com/x', 'javascript:alert(1)', '', '   ', `${page}\0.txt`, 42, null]) {
      expect(resolveOpenPath(bad, env).ok, String(bad)).toBe(false);
    }
  });

  it('refuses a path that does not exist', () => {
    expect(resolveOpenPath(path.join(dir, 'nope.html'), env)).toEqual({ ok: false, reason: 'File not found' });
  });

  it('refuses things the OS would run — by extension, inside a bundle, or by exec bit', () => {
    for (const p of ['/Applications/Calculator.app', '/Applications/X.app/Contents/MacOS/X', '/tmp/a.command', '/tmp/setup.exe', '/tmp/x.pkg']) {
      expect(resolveOpenPath(p, { ...env, exists: () => true }).ok, p).toBe(false);
    }
    expect(resolveOpenPath(script, env)).toEqual({ ok: false, reason: 'Refusing to open an executable file' });
  });

  it('normalises ../ rather than trusting it', () => {
    const r = resolveOpenPath(path.join(dir, 'sub', '..', 'index.html'), env);
    expect(r).toEqual({ ok: true, path: page });
  });

  it('.js is a document on macOS and a program on Windows', () => {
    const always = { ...env, exists: () => true, isExecutableFile: () => false };
    expect(resolveOpenPath('/tmp/app.js', always).ok).toBe(true);
    expect(resolveOpenPath('C:\\\\Users\\\\me\\\\app.js', { ...always, platform: 'win32' }).ok).toBe(false);
  });

  it('never throws, and only ever returns an absolute existing path (property)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constant('file:'), fc.webUrl()), (input) => {
        const r = resolveOpenPath(input, env);
        if (r.ok) {
          expect(path.isAbsolute(r.path)).toBe(true);
          expect(fs.existsSync(r.path)).toBe(true);
        } else {
          expect(typeof r.reason).toBe('string');
        }
      }),
      { numRuns: 500 },
    );
  });
});
