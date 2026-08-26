#!/usr/bin/env node
/**
 * Postinstall — cross-platform.
 *
 * This was a shell chain in package.json: `cp … && mkdir -p … && cp …`. It
 * ran `cp` and `mkdir -p` through cmd.exe on Windows, where neither exists,
 * so `npm ci` failed on the release runner and the Windows installer could
 * never build. Everything here is fs.* — same work, every platform.
 *
 * Steps:
 *   1. patch-electron-name (macOS bundle rename; self-guards elsewhere)
 *   2. pdf.js worker → public/
 *   3. highlight.js themes → public/hljs/
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function copyIfPossible(src, dest, label) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`[postinstall] copied ${label}`);
  } catch (err) {
    // A missing optional asset must not fail the whole install — but say so,
    // loudly enough to be found, because the consumer fails at runtime.
    console.warn(`[postinstall] could not copy ${label}: ${err.message}`);
  }
}

// 1. Electron rename + node-pty spawn-helper bit (both self-guard by platform).
// Required as a child process rather than require(): the script calls
// process.exit(0) on non-macOS, which would end this one too.
const { spawnSync } = require('child_process');
const patch = spawnSync(process.execPath, [path.join(__dirname, 'patch-electron-name.js')], {
  stdio: 'inherit',
});
if (patch.error) console.warn(`[postinstall] patch-electron-name: ${patch.error.message}`);

// 2. pdf.js worker — the pdf-renderer loads it from /pdf.worker.min.mjs.
copyIfPossible(
  path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
  path.join(root, 'public', 'pdf.worker.min.mjs'),
  'pdf.worker.min.mjs',
);

// 3. highlight.js themes — served locally so syntax highlighting works offline
// (see code-renderer.tsx for why a CDN is not an option in a desktop app).
copyIfPossible(
  path.join(root, 'node_modules', 'highlight.js', 'styles', 'github.css'),
  path.join(root, 'public', 'hljs', 'github.css'),
  'hljs/github.css',
);
copyIfPossible(
  path.join(root, 'node_modules', 'highlight.js', 'styles', 'github-dark.css'),
  path.join(root, 'public', 'hljs', 'github-dark.css'),
  'hljs/github-dark.css',
);
