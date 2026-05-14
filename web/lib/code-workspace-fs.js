/**
 * Main-process filesystem helpers for the IDE workspace (Code surface).
 *
 * - Walks a directory (one level deep, lazy) honouring .gitignore + a hard
 *   ignore list (.git, node_modules).
 * - Reads a file as utf-8, returns null when the bytes look binary.
 *
 * Loaded from main-web.js via require(). Mirrors the type shape declared in
 * src/lib/code-workspace/fs-tree.ts (kept in sync by hand — main is CJS and
 * can't import TS directly, so we duplicate the contract here).
 */

const fs = require("fs");
const path = require("path");
const ignoreLib = require("ignore");

const HARD_IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", ".DS_Store"]);

/**
 * Walk up from `start` looking for a .gitignore. Returns its parsed `ignore`
 * instance plus the dir it was found in, or null if none found within the
 * workspace boundary.
 */
function loadGitignore(workspaceRoot, start) {
  let dir = path.resolve(start);
  const root = path.resolve(workspaceRoot);
  // Don't walk above the workspace root.
  while (dir.startsWith(root) || dir === root) {
    const candidate = path.join(dir, ".gitignore");
    try {
      const content = fs.readFileSync(candidate, "utf-8");
      const ig = ignoreLib();
      ig.add(content);
      return { ig, base: dir };
    } catch {
      // not found; continue up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    if (dir === root) break;
    dir = parent;
  }
  return null;
}

/**
 * One-level children of `dirPath`. Returns FsNode[] sorted (dirs first,
 * alphabetical).
 *
 * @param {string} workspaceRoot Absolute workspace root (gitignore boundary)
 * @param {string} dirPath       Absolute path to walk
 * @param {{ respectGitignore?: boolean }} [opts]
 */
function walkOne(workspaceRoot, dirPath, opts) {
  const respectGitignore = opts?.respectGitignore !== false;
  const absDir = path.resolve(dirPath);
  const root = path.resolve(workspaceRoot);

  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    return { nodes: [], error: err && err.message ? err.message : String(err) };
  }

  let ig = null;
  let igBase = null;
  if (respectGitignore) {
    const loaded = loadGitignore(root, absDir);
    if (loaded) {
      ig = loaded.ig;
      igBase = loaded.base;
    }
  }

  const nodes = [];
  for (const entry of entries) {
    const name = entry.name;
    if (HARD_IGNORE_DIRS.has(name)) continue;

    const absPath = path.join(absDir, name);
    const isDir = entry.isDirectory();

    // gitignore takes paths *relative to where the .gitignore lives*.
    if (ig && igBase) {
      const rel = path.relative(igBase, absPath);
      if (rel && !rel.startsWith("..")) {
        // ignore() returns true if the path is ignored. For dirs, append /
        // so that directory rules match.
        const testPath = isDir ? `${rel}/` : rel;
        if (ig.ignores(testPath)) continue;
      }
    }

    nodes.push({
      name,
      path: absPath,
      type: isDir ? "dir" : "file",
    });
  }

  // dirs first, then alphabetical
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { nodes };
}

/**
 * Detect binary by inspecting the first 8KB for a byte < 0x09 (excluding
 * 0x0A LF and 0x0D CR). Mirrors common editor heuristics.
 */
function looksBinary(buf) {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    const b = buf[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x09) return true;
  }
  return false;
}

/**
 * Reads a file. Returns { content, encoding } as utf-8 text, or null when
 * the file looks binary / can't be read.
 *
 * Large files (> 2MB) still return contents — the renderer is responsible
 * for the "load anyway?" gate.
 */
function readFileSafe(filePath) {
  const abs = path.resolve(filePath);
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }

  if (looksBinary(buf)) {
    return { binary: true };
  }

  return {
    content: buf.toString("utf-8"),
    encoding: "utf-8",
    size: buf.length,
  };
}

/**
 * Writes a text file. Refuses to overwrite anything that currently looks
 * binary on disk — protects images / archives from being clobbered with
 * UTF-8 text by an editor that misread the kind. Returns { ok, error }.
 */
function writeFileSafe(filePath, content) {
  const abs = path.resolve(filePath);
  try {
    if (fs.existsSync(abs)) {
      const existing = fs.readFileSync(abs);
      if (looksBinary(existing)) {
        return { ok: false, error: "Refusing to overwrite binary file as text." };
      }
    }
    fs.writeFileSync(abs, String(content ?? ""), "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  walkOne,
  readFileSafe,
  writeFileSafe,
  HARD_IGNORE_DIRS,
};
