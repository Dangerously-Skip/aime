#!/usr/bin/env node
/**
 * Patches the Electron.app bundle so macOS shows "AIME" in the dock.
 * Runs as a postinstall script — re-run after npm install.
 *
 * What it does:
 *   1. Renames Electron.app → AIME.app
 *   2. Patches Info.plist CFBundleName + CFBundleDisplayName
 *   3. Updates the electron npm package's path export to point to the renamed binary
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_NAME = 'AIME';
const electronDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const oldApp = path.join(electronDir, 'Electron.app');
const newApp = path.join(electronDir, `${APP_NAME}.app`);

// node-pty's spawn-helper binary sometimes loses its executable bit when
// extracted from the npm tarball. Without +x, `pty.fork` fails with
// `posix_spawnp failed` and the terminal panel can't open. Fix it here so
// every fresh install has a working PTY out of the box.
function fixNodePtySpawnHelper() {
  if (process.platform === 'win32') return;
  const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
  if (!fs.existsSync(prebuilds)) return;
  for (const variant of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, variant, 'spawn-helper');
    try {
      const st = fs.statSync(helper);
      if ((st.mode & 0o111) === 0) {
        fs.chmodSync(helper, st.mode | 0o755);
        console.log(`Marked node-pty spawn-helper executable: ${variant}`);
      }
    } catch {
      // not present on this platform — skip
    }
  }
}
fixNodePtySpawnHelper();

// Only run on macOS
if (process.platform !== 'darwin') {
  console.log('Skipping Electron rename (not macOS)');
  process.exit(0);
}

if (!fs.existsSync(oldApp) && !fs.existsSync(newApp)) {
  console.log('Electron.app not found, skipping');
  process.exit(0);
}

// 1. Rename the .app bundle
if (fs.existsSync(oldApp)) {
  if (fs.existsSync(newApp)) fs.rmSync(newApp, { recursive: true });
  fs.renameSync(oldApp, newApp);
  console.log(`Renamed Electron.app → ${APP_NAME}.app`);
}

// 2. Patch Info.plist
const plist = path.join(newApp, 'Contents', 'Info.plist');
if (fs.existsSync(plist)) {
  execSync(`plutil -replace CFBundleName -string "${APP_NAME}" "${plist}"`);
  execSync(`plutil -replace CFBundleDisplayName -string "${APP_NAME}" "${plist}"`);
  console.log('Patched Info.plist');
}

// 3. Update electron's path export so `require('electron')` still resolves the binary.
//
// Keyed on the BINARY existing, not on path.txt existing. The previous guard was
// `existsSync(path.txt)`, which made this a no-op in exactly the case it exists
// for: electron's own install.js writes path.txt when it downloads dist/, so if
// that download is skipped or the file is lost (a copied node_modules, a pruned
// or offline install), the guard fell through — leaving the bundle renamed to
// AIME.app with nothing pointing at it, and `require('electron')` throwing
// "Electron failed to install correctly, please delete node_modules/electron".
// The path is known here, so writing it is always correct when the binary is there.
const electronPathFile = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
const newBinaryPath = path.join(`${APP_NAME}.app`, 'Contents', 'MacOS', 'Electron');
if (fs.existsSync(path.join(electronDir, newBinaryPath))) {
  fs.writeFileSync(electronPathFile, newBinaryPath);
  console.log('Updated electron path.txt');
} else {
  console.warn(`Electron binary missing at dist/${newBinaryPath} — leaving path.txt alone`);
}

console.log(`Done — dock will show "${APP_NAME}"`);
