#!/usr/bin/env node
/**
 * Make `.next/standalone` safe for electron-builder to copy, by leaving no
 * symlinks in it.
 *
 * `next build` writes a hashed alias into `.next/standalone/.next/node_modules/`
 * for each package the server resolves as an external, pointing back down at
 * `../../node_modules/<pkg>`. Two different things then go wrong when
 * electron-builder copies the tree as an `extraResources` entry, and fixing only
 * the first reveals the second:
 *
 *   1. DEAD alias. A package in `serverExternalPackages` is deliberately not
 *      copied into the standalone tree, but the alias is written anyway:
 *
 *        pdfjs-dist-29912611d2e8a9df -> ../../node_modules/pdfjs-dist  (absent)
 *
 *      electron-builder stats it, follows it, and the build dies with
 *      `ENOENT ... stat '.../pdfjs-dist-<hash>'`. Nothing needs this one:
 *      pdfjs-dist reaches the app through its own `extraResources` entry and
 *      `lib/extractors/pdf.ts` resolves it by absolute path from
 *      `AIME_RESOURCES_PATH`. Delete it.
 *
 *   2. LIVE alias. `pino`, `imapflow`'s nested `pino`, and
 *      `@huggingface/transformers` all resolve fine in the source tree — and
 *      still fail, at the DESTINATION path inside `AIME.app`. electron-builder
 *      walks in directory order, so `.next/` is copied before `node_modules/`;
 *      the link arrives before the directory it points at exists, and the stat
 *      throws there instead. Copy the target's contents over the link.
 *
 * The live ones cannot simply be deleted, which is what `release.yml` used to do
 * — a `find` for `*-<10 hex chars>*` that matched every alias, dead or live.
 * Server chunks reference those hashed directory names directly:
 *
 *   .next/server/chunks/[externals]_@huggingface_transformers_118b758d._.js
 *
 * so deleting them would have shipped an app whose logging and local embeddings
 * fail at runtime. It was never caught because `build-mac` has never had a
 * runner to fail on. Materialising costs about 216K across the three.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * Replace every symlink under `dir` with what it means: real contents if the
 * target exists, nothing at all if it does not.
 *
 * Returns what happened, so the caller can print it and a test can assert it.
 */
function resolveLinks(dir) {
  const removed = [];
  const materialised = [];

  /** Collect first, act second — copying into the tree mid-walk would re-visit. */
  const links = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      // Never descend THROUGH a symlink: one pointing up the tree would loop.
      if (entry.isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  // Not required for correctness — the two passes below make order irrelevant —
  // but it keeps the log stable between runs.
  links.sort();

  /*
   * Dead links go FIRST, across the whole tree, before anything is copied.
   *
   * `cpSync(..., {dereference: true})` does NOT resolve a dangling link inside
   * the tree it is copying and does not fail on one either: it reproduces it at
   * the destination, as an ABSOLUTE symlink to a path that does not exist. So a
   * single pass would faithfully copy the very ENOENT this script exists to
   * prevent into a directory the walk has already gone past. Clearing them all
   * up front means every copy below runs over a tree already known to be sound.
   *
   * `existsSync` follows the link, so it asks exactly what electron-builder's
   * stat is about to ask.
   */
  for (const link of links) {
    if (!fs.existsSync(link)) {
      fs.unlinkSync(link);
      removed.push(link);
    }
  }

  for (const link of links) {
    if (removed.includes(link)) continue;
    const target = path.resolve(path.dirname(link), fs.readlinkSync(link));
    fs.unlinkSync(link);
    fs.cpSync(target, link, { recursive: true, dereference: true });
    materialised.push(link);
  }

  return { removed, materialised };
}

module.exports = { resolveLinks };

// Only when run as a command — the test imports `resolveLinks` directly.
if (require.main === module) {
  const root = path.join(process.cwd(), '.next', 'standalone');
  if (!fs.existsSync(root)) {
    console.log('resolve-standalone-links: no .next/standalone — nothing to do.');
    process.exit(0);
  }
  const { removed, materialised } = resolveLinks(root);
  const rel = (p) => path.relative(root, p);
  console.log(
    `resolve-standalone-links: ${materialised.length} materialised, ${removed.length} dead link(s) removed.`,
  );
  for (const p of materialised) console.log(`  copied   ${rel(p)}`);
  for (const p of removed) console.log(`  removed  ${rel(p)}`);
}
