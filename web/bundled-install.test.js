import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { syncBundledDir, MANIFEST } = require('./bundled-install.js');

/**
 * The installer must not delete the user's work.
 *
 * It did. Both bundled directories were installed with `rmSync(dest)` followed
 * by `cpSync(src, dest)` — "remove and recopy so updates land every launch",
 * which lands updates and also wipes everything the user put there. That is not
 * a hypothetical directory: `brand-guidelines` ships as a template whose stated
 * purpose is to be filled in, and the ppt plugin's `brands/` is where a second
 * brand goes. Anyone who followed the instructions lost it at the next launch,
 * with no error and no trace.
 *
 * Deleting nothing is not the fix either — a withdrawn skill would linger and
 * keep being loaded by the SDK's plugin scan. So the installer records what it
 * wrote, and may only remove things from that list.
 */

let src, dest;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-install-'));
  src = path.join(root, 'src');
  dest = path.join(root, 'dest');
  fs.mkdirSync(src, { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(src), { recursive: true, force: true });
});

const write = (base, rel, body) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const read = (base, rel) => fs.readFileSync(path.join(base, rel), 'utf-8');
const exists = (base, rel) => fs.existsSync(path.join(base, rel));

describe('bundled files are installed and kept current', () => {
  it('copies the bundle on a first install', () => {
    write(src, 'skills/craft-web/SKILL.md', 'v1');
    const r = syncBundledDir(src, dest);
    expect(read(dest, 'skills/craft-web/SKILL.md')).toBe('v1');
    expect(r.written).toBe(1);
  });

  it('overwrites a bundled file that changed, so updates land', () => {
    write(src, 'skills/craft-web/SKILL.md', 'v1');
    syncBundledDir(src, dest);
    write(src, 'skills/craft-web/SKILL.md', 'v2');
    syncBundledDir(src, dest);
    expect(read(dest, 'skills/craft-web/SKILL.md')).toBe('v2');
  });

  it('removes a file it installed that is no longer bundled', () => {
    write(src, 'skills/old/SKILL.md', 'retired');
    syncBundledDir(src, dest);
    expect(exists(dest, 'skills/old/SKILL.md')).toBe(true);

    fs.rmSync(path.join(src, 'skills/old'), { recursive: true });
    write(src, 'skills/new/SKILL.md', 'current');
    const r = syncBundledDir(src, dest);

    // Withdrawn means withdrawn — otherwise the SDK keeps loading it.
    expect(exists(dest, 'skills/old/SKILL.md')).toBe(false);
    expect(exists(dest, 'skills/new/SKILL.md')).toBe(true);
    expect(r.removed).toBe(1);
  });
});

describe('the user’s own files survive', () => {
  /**
   * The bug, stated directly: a brand the user added to the plugin directory
   * has to still be there after a restart.
   */
  it('keeps a directory the user added', () => {
    write(src, 'brands/default/config.yaml', 'default');
    syncBundledDir(src, dest);

    write(dest, 'brands/acme/config.yaml', 'my brand');
    write(dest, 'brands/acme/Template.pptx', 'binary-ish');

    const r = syncBundledDir(src, dest);
    expect(read(dest, 'brands/acme/config.yaml')).toBe('my brand');
    expect(exists(dest, 'brands/acme/Template.pptx')).toBe(true);
    expect(r.preserved).toBe(2);
  });

  it('survives many launches, not just one', () => {
    write(src, 'skills/a/SKILL.md', 'bundled');
    syncBundledDir(src, dest);
    write(dest, 'brands/acme/config.yaml', 'mine');
    for (let i = 0; i < 5; i++) syncBundledDir(src, dest);
    expect(read(dest, 'brands/acme/config.yaml')).toBe('mine');
  });

  /**
   * A user file cannot be deleted even when it sits in the same directory as a
   * bundled file that WAS withdrawn — the removal is by manifest path, not by
   * directory.
   */
  it('does not take user files with it when cleaning a shared directory', () => {
    write(src, 'brands/default/a.yaml', 'bundled');
    syncBundledDir(src, dest);
    write(dest, 'brands/default/mine.yaml', 'user');

    fs.rmSync(path.join(src, 'brands/default/a.yaml'));
    write(src, 'skills/x/SKILL.md', 'other');
    syncBundledDir(src, dest);

    expect(exists(dest, 'brands/default/a.yaml')).toBe(false);
    expect(read(dest, 'brands/default/mine.yaml')).toBe('user');
  });

  /**
   * Upgrading from the old wipe-and-copy: there is no manifest yet, so the
   * installer knows nothing about what is there and must delete nothing.
   */
  it('deletes nothing on the first run after the old installer', () => {
    write(dest, 'brands/acme/config.yaml', 'pre-existing');
    write(dest, 'skills/stale/SKILL.md', 'unknown provenance');
    write(src, 'skills/a/SKILL.md', 'bundled');

    const r = syncBundledDir(src, dest);
    expect(r.removed).toBe(0);
    expect(exists(dest, 'brands/acme/config.yaml')).toBe(true);
    expect(exists(dest, 'skills/stale/SKILL.md')).toBe(true);
  });
});

describe('the manifest', () => {
  it('records what was installed', () => {
    write(src, 'skills/a/SKILL.md', 'x');
    write(src, 'brands/default/c.yaml', 'y');
    syncBundledDir(src, dest);
    const m = JSON.parse(read(dest, MANIFEST));
    expect(m.files.sort()).toEqual(['brands/default/c.yaml', 'skills/a/SKILL.md']);
  });

  it('is not itself treated as a user file', () => {
    write(src, 'skills/a/SKILL.md', 'x');
    syncBundledDir(src, dest);
    expect(syncBundledDir(src, dest).preserved).toBe(0);
  });

  it('recovers from a corrupt manifest by deleting nothing', () => {
    write(src, 'skills/a/SKILL.md', 'x');
    syncBundledDir(src, dest);
    write(dest, MANIFEST, 'not json{');
    write(dest, 'brands/acme/c.yaml', 'mine');
    fs.rmSync(path.join(src, 'skills/a/SKILL.md'));
    write(src, 'skills/b/SKILL.md', 'y');

    const r = syncBundledDir(src, dest);
    expect(r.removed).toBe(0);
    expect(exists(dest, 'brands/acme/c.yaml')).toBe(true);
  });
});

describe('the packaging allowlist', () => {
  /**
   * `electron-builder`'s `files` is an allowlist, so a root-level module that
   * `main-web.js` requires and nobody adds there is simply absent from the
   * packaged app — and the failure appears only in a built DMG, as skills that
   * silently never install. `credential-key.js` is in the list for exactly this
   * reason; this makes the next one automatic.
   */
  it('contains every root-level .js that main-web.js requires', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    const allowed = new Set(pkg.build?.files ?? []);
    const main = fs.readFileSync(path.resolve(process.cwd(), 'main-web.js'), 'utf-8');

    const required = [...main.matchAll(/require\(\s*["']\.\/([\w.-]+\.js)["']\s*\)/g)].map(
      (m) => m[1],
    );
    expect(required.length, 'no local requires found — has the pattern changed?').toBeGreaterThan(0);

    for (const rel of required) {
      expect(
        allowed.has(rel),
        `main-web.js requires ./${rel}, but it is not in package.json build.files — ` +
          `it will be missing from the packaged app`,
      ).toBe(true);
    }
  });
});
