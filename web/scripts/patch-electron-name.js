#!/usr/bin/env node
/**
 * Patches the Electron.app bundle so macOS shows "Quarry" in the dock.
 * Runs as a postinstall script — re-run after npm install.
 *
 * What it does:
 *   1. Renames Electron.app → Quarry.app
 *   2. Patches Info.plist CFBundleName + CFBundleDisplayName
 *   3. Updates the electron npm package's path export to point to the renamed binary
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_NAME = 'Quarry';
const electronDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const oldApp = path.join(electronDir, 'Electron.app');
const newApp = path.join(electronDir, `${APP_NAME}.app`);

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

// 3. Update electron's path export so `require('electron')` still resolves the binary
const electronPathFile = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
const newBinaryPath = path.join(`${APP_NAME}.app`, 'Contents', 'MacOS', 'Electron');
if (fs.existsSync(electronPathFile)) {
  fs.writeFileSync(electronPathFile, newBinaryPath);
  console.log('Updated electron path.txt');
}

console.log(`Done — dock will show "${APP_NAME}"`);
