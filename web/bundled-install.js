/**
 * Install a bundled directory into ~/.claude/plugins without eating user files.
 *
 * The previous implementation was:
 *
 *     fs.rmSync(destDir, { recursive: true, force: true });
 *     fs.cpSync(srcDir, destDir, { recursive: true });
 *
 * "Remove and recopy so updates land every launch" — which does land updates,
 * and also deletes everything the user put there. That matters because the
 * bundled content is not read-only reference material: `brand-guidelines`
 * ships as a template whose whole purpose is to be filled in, and the ppt
 * plugin's `brands/` directory is where a second brand would go. Both live
 * inside the wiped directory, so anyone who followed the instructions lost
 * their work at the next launch, silently.
 *
 * Deleting nothing is not the answer either: a skill removed from the bundle
 * would linger forever and be loaded by the SDK's plugin scan, so a renamed or
 * withdrawn skill could never actually be withdrawn.
 *
 * So the installer remembers what it put there. A manifest of the relative
 * paths it wrote lets the next run delete exactly its own leftovers and nothing
 * else. Files the user added are not in the manifest, so they are never
 * candidates for deletion — the property that was missing.
 */

const fs = require('fs');
const path = require('path');

/** Written at the destination root. Underscore-prefixed to sort out of the way. */
const MANIFEST = '.aime-bundle-manifest.json';

/** Every file under `dir`, as paths relative to it, POSIX-separated. */
function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function readManifest(destDir) {
  try {
    const raw = fs.readFileSync(path.join(destDir, MANIFEST), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch {
    // No manifest: either a first install, or one written by the old
    // wipe-and-copy. Treat as empty — deleting nothing is the safe default,
    // and the next run will have a manifest to work from.
    return [];
  }
}

/** Remove empty directories left behind after deleting stale files. */
function pruneEmptyDirs(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt) && current !== stopAt) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * Copy `srcDir` over `destDir`, updating bundled files and preserving the
 * user's own.
 *
 * @returns {{written: number, removed: number, preserved: number}}
 */
function syncBundledDir(srcDir, destDir) {
  const bundled = listFiles(srcDir);
  const previous = readManifest(destDir);

  fs.mkdirSync(destDir, { recursive: true });

  for (const rel of bundled) {
    const to = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(srcDir, rel), to);
  }

  // Only paths WE installed last time and no longer ship. A user's file was
  // never in the manifest, so it can never be selected here.
  const bundledSet = new Set(bundled);
  let removed = 0;
  for (const rel of previous) {
    if (bundledSet.has(rel)) continue;
    const stale = path.join(destDir, rel);
    try {
      if (fs.existsSync(stale)) {
        fs.rmSync(stale, { force: true });
        removed++;
        pruneEmptyDirs(path.dirname(stale), destDir);
      }
    } catch {
      /* a file we cannot remove is not worth failing the launch over */
    }
  }

  fs.writeFileSync(
    path.join(destDir, MANIFEST),
    JSON.stringify({ files: bundled, installedAt: new Date().toISOString() }, null, 2),
  );

  const preserved = listFiles(destDir).filter(
    (f) => f !== MANIFEST && !bundledSet.has(f),
  ).length;

  return { written: bundled.length, removed, preserved };
}

module.exports = { syncBundledDir, MANIFEST };
