import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { resolveLinks } = require_('./resolve-standalone-links.js') as {
  resolveLinks: (dir: string) => { removed: string[]; materialised: string[] };
};

/**
 * A REAL temp tree, not a mocked `fs`.
 *
 * What this guards is electron-builder stating a symlink and getting ENOENT. A
 * fake filesystem would answer whatever the fake was written to answer, which is
 * the one thing not in question. Making actual symlinks and reading them back is
 * the entire test.
 */
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-links-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const aliasDir = () => path.join(root, '.next', 'node_modules');

/** The shape `next build` leaves behind, reproduced. */
function buildTree() {
  fs.mkdirSync(path.join(root, 'node_modules', 'pino'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pino', 'index.js'), '// pino');
  fs.mkdirSync(path.join(root, 'node_modules', 'pino', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pino', 'lib', 'deep.js'), '// nested');

  fs.mkdirSync(aliasDir(), { recursive: true });
  // Live: the tracer copied the target into the standalone tree.
  fs.symlinkSync('../../node_modules/pino', path.join(aliasDir(), 'pino-28069d5257187539'));
  // Dead: `serverExternalPackages` kept the tracer from copying it.
  fs.symlinkSync('../../node_modules/pdfjs-dist', path.join(aliasDir(), 'pdfjs-dist-29912611d2e8a9df'));
  // An ordinary file, to prove nothing is being deleted by name pattern.
  fs.writeFileSync(path.join(aliasDir(), 'pdfjs-dist-29912611d2e8a9df.txt'), 'keep me');
}

describe('resolve-standalone-links', () => {
  it('materialises the live alias as real contents', () => {
    buildTree();
    const alias = path.join(aliasDir(), 'pino-28069d5257187539');

    const { materialised } = resolveLinks(root);

    expect(materialised).toEqual([alias]);
    // `lstat`, not `exists`: the point is that it is no longer a link.
    expect(fs.lstatSync(alias).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(alias, 'index.js'), 'utf8')).toBe('// pino');
    // Recursive, not just the top level.
    expect(fs.readFileSync(path.join(alias, 'lib', 'deep.js'), 'utf8')).toBe('// nested');
    // The original is untouched — real code still resolves the direct path too.
    expect(fs.existsSync(path.join(root, 'node_modules', 'pino', 'index.js'))).toBe(true);
  });

  it('deletes the dead alias, and only it', () => {
    buildTree();

    const { removed } = resolveLinks(root);

    expect(removed).toEqual([path.join(aliasDir(), 'pdfjs-dist-29912611d2e8a9df')]);
    expect(fs.existsSync(path.join(aliasDir(), 'pdfjs-dist-29912611d2e8a9df'))).toBe(false);
    expect(fs.existsSync(path.join(aliasDir(), 'pdfjs-dist-29912611d2e8a9df.txt'))).toBe(true);
  });

  it('leaves no symlink anywhere in the tree — the property electron-builder needs', () => {
    buildTree();
    resolveLinks(root);

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? [full, ...walk(full)] : [full];
      });

    const entries = walk(root);
    expect(entries.filter((e) => fs.lstatSync(e).isSymbolicLink())).toEqual([]);
    // The pre-fix failure was this stat throwing, at the destination path.
    for (const entry of entries) expect(() => fs.statSync(entry)).not.toThrow();
  });

  it('survives a copy order that puts the alias before its target', () => {
    // The actual production failure: electron-builder walks `.next/` before
    // `node_modules/`, so at the destination the link exists and the target does
    // not. Copying the resolved tree in that order must still produce a working
    // alias, which it can only do if the alias is real contents.
    buildTree();
    resolveLinks(root);

    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-dest-'));
    try {
      // `.next` first, exactly as the failing build did.
      fs.cpSync(path.join(root, '.next'), path.join(dest, '.next'), { recursive: true });
      fs.cpSync(path.join(root, 'node_modules'), path.join(dest, 'node_modules'), { recursive: true });

      const copied = path.join(dest, '.next', 'node_modules', 'pino-28069d5257187539', 'index.js');
      expect(fs.readFileSync(copied, 'utf8')).toBe('// pino');
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it('walks THROUGH no symlink, so a nested link is seen once via its real path', () => {
    buildTree();
    // A dead link inside the package the live alias points at. Reachable two
    // ways: `node_modules/pino/stale` and `.next/node_modules/pino-<hash>/stale`.
    // Descending through the alias would visit — and try to unlink — the second.
    fs.symlinkSync('./gone', path.join(root, 'node_modules', 'pino', 'stale'));

    const { removed } = resolveLinks(root);

    expect(removed).toEqual([
      path.join(aliasDir(), 'pdfjs-dist-29912611d2e8a9df'),
      path.join(root, 'node_modules', 'pino', 'stale'),
    ]);
    // And it must not come BACK through the copy. `cpSync` with
    // `dereference: true` neither resolves nor rejects a dangling link — it
    // reproduces it at the destination as an absolute link to nothing. Clearing
    // dead links before any copying is the only reason this path is clean.
    const revived = path.join(aliasDir(), 'pino-28069d5257187539', 'stale');
    expect(fs.existsSync(revived)).toBe(false);
    expect(fs.lstatSync(revived, { throwIfNoEntry: false })).toBeUndefined();
  });
});
