/**
 * Main-process PTY manager for the Code-surface terminal.
 *
 * Wraps node-pty. Each PTY lives in a Map keyed by generated session ID.
 * Output and exit events fan out to every BrowserWindow over IPC so the
 * renderer can attach an xterm.js instance to a session by ID.
 *
 * The module exports a small lifecycle API: open / write / resize / close /
 * closeAll. main-web.js wires the ipcMain handlers and the app `before-quit`
 * cleanup.
 *
 * macOS prebuilt-binary quirk: node-pty's tarball ships `spawn-helper`
 * without the executable bit on some npm versions. Without it `pty.fork`
 * fails with `posix_spawnp failed`. We fix permissions at module load so
 * the dev-mode boot works even when the postinstall script wasn't run.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let nodePty = null;
let loadError = null;

function ensureSpawnHelperExecutable() {
  // Only matters on darwin / linux prebuilds.
  if (process.platform === 'win32') return;
  try {
    // __dirname is web/src/lib/code-workspace at dev time, and lives inside
    // app.asar.unpacked once packaged. Walk up to find node_modules.
    const webRoot = path.resolve(__dirname, '..', '..', '..');
    const candidates = [
      path.join(webRoot, 'node_modules/node-pty/prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      // Packaged-app: node-pty is asar-unpacked, so the binary lives outside the asar.
      path.join(webRoot, '..', 'app.asar.unpacked', 'node_modules/node-pty/prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      // Resourced layout (electron-builder default with extraResources):
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules/node-pty/prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    ];
    for (const candidate of candidates) {
      try {
        const st = fs.statSync(candidate);
        // Already executable? Skip. Otherwise add the x bit.
        if ((st.mode & 0o111) === 0) {
          fs.chmodSync(candidate, st.mode | 0o755);
          console.log(`[pty] chmod +x ${candidate}`);
        }
      } catch {
        // Candidate doesn't exist on this platform — ignore.
      }
    }
  } catch (err) {
    console.warn('[pty] spawn-helper chmod fixup failed:', err?.message);
  }
}

/**
 * node-pty is an OPTIONAL dependency, and this is the reason the lazy require
 * and the catch below are load-bearing rather than defensive habit.
 *
 * It is a native module: with no prebuild for the platform/node combination it
 * falls back to node-gyp, which needs a C toolchain. A machine without one — a
 * bare CI runner, or anyone installing from source — got a hard `npm ci`
 * failure over a feature they may never open. Optional means the install
 * succeeds and only the terminal is missing, which is what this function
 * already reported.
 */
function loadPty() {
  if (nodePty || loadError) return nodePty;
  try {
    ensureSpawnHelperExecutable();
    // eslint-disable-next-line global-require
    nodePty = require('node-pty');
  } catch (err) {
    loadError = err;
    console.error(
      '[pty] node-pty unavailable, terminal disabled:',
      err?.message,
      '— install a C toolchain (build-essential/Xcode CLI tools) and reinstall to enable it',
    );
  }
  return nodePty;
}

/** session id → { pty, cwd, shell, cols, rows } */
const sessions = new Map();

function broadcast(channel, payload) {
  try {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  } catch {
    // No electron context (e.g. tests) — silent no-op.
  }
}

function pickShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Open a new PTY.
 *
 * @param {{ cwd: string; cols?: number; rows?: number }} opts
 * @returns {{ id: string; cwd: string; shell: string; cols: number; rows: number } | null}
 */
function open(opts) {
  const pty = loadPty();
  if (!pty) {
    console.error('[pty] open() called but node-pty failed to load');
    return null;
  }

  const cols = Math.max(1, Math.floor(opts?.cols ?? 80));
  const rows = Math.max(1, Math.floor(opts?.rows ?? 24));
  const cwd = (opts && opts.cwd && fs.existsSync(opts.cwd)) ? opts.cwd : (process.env.HOME || process.cwd());
  const shell = pickShell();

  // Pass through the user's env so PATH, HOME, etc. work. node-pty wants
  // TERM/COLORTERM hints so xterm-256color rendering kicks in.
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
  // Electron-injected vars that confuse interactive shells.
  delete env.ELECTRON_RUN_AS_NODE;

  let term;
  try {
    term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cwd,
      env,
      cols,
      rows,
    });
  } catch (err) {
    console.error('[pty] spawn failed:', err?.message);
    return null;
  }

  const id = crypto.randomBytes(8).toString('hex');
  const session = { id, pty: term, cwd, shell, cols, rows };
  sessions.set(id, session);

  term.onData((data) => {
    broadcast('pty:output', { id, data });
  });

  term.onExit(({ exitCode, signal }) => {
    sessions.delete(id);
    broadcast('pty:exit', { id, code: typeof exitCode === 'number' ? exitCode : null, signal: signal ?? null });
  });

  console.log(`[pty] opened ${id} (${shell} in ${cwd}, ${cols}x${rows})`);

  return { id, cwd, shell, cols, rows };
}

function write(id, data) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.write(data);
  } catch (err) {
    console.warn(`[pty] write ${id} failed:`, err?.message);
  }
}

function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (!s) return;
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  try {
    s.pty.resize(c, r);
    s.cols = c;
    s.rows = r;
  } catch (err) {
    console.warn(`[pty] resize ${id} failed:`, err?.message);
  }
}

function close(id) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch (err) {
    console.warn(`[pty] kill ${id} failed:`, err?.message);
  }
  sessions.delete(id);
}

function closeAll() {
  for (const id of Array.from(sessions.keys())) {
    close(id);
  }
}

function list() {
  return Array.from(sessions.values()).map(({ id, cwd, shell, cols, rows }) => ({
    id, cwd, shell, cols, rows,
  }));
}

module.exports = { open, write, resize, close, closeAll, list };
