import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * The policies in this directory are tested as pure functions. This file checks
 * the other half — that main-web.js actually applies them — by reading its
 * source, because main-web.js runs only inside Electron. Each assertion names a
 * hole that existed: a policy nobody calls is the shape of the four security
 * toggles that shipped doing nothing.
 */

const src = readFileSync(path.resolve(__dirname, '..', 'main-web.js'), 'utf-8');
// Comments stripped only where they start a line: `"*://*.google.com/*"` in a
// URL pattern would otherwise open a "block comment" and swallow the file.
const code = src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');

function body(fnName) {
  const start = code.indexOf(`function ${fnName}(`);
  expect(start, `${fnName} exists`).toBeGreaterThan(-1);
  // Up to the next top-level function declaration.
  const next = code.slice(start + 1).search(/\n(async )?function |\napp\.|\nipc\./);
  return code.slice(start, next === -1 ? undefined : start + 1 + next);
}

describe('main window', () => {
  it('guards both will-navigate and will-redirect with the navigation policy', () => {
    const guard = body('guardMainWindowNavigation');
    expect(guard).toMatch(/navPolicy\.classifyNavigation\(/);
    expect(guard).toMatch(/on\("will-navigate",/);
    expect(guard).toMatch(/on\("will-redirect",/);
    expect(guard).toMatch(/preventDefault\(\)/);
  });

  it('never lets window.open create a window (children inherit the preload)', () => {
    const guard = body('guardMainWindowNavigation');
    expect(guard).toMatch(/setWindowOpenHandler/);
    expect(guard).toMatch(/navPolicy\.windowOpenAction\(/);
    expect(guard).not.toMatch(/action:\s*"allow"/);
  });

  it('createWindow applies the guard to the window it creates', () => {
    expect(body('createWindow')).toMatch(/guardMainWindowNavigation\(mainWindow,/);
  });

  it('no window anywhere is allowed to open from a window-open handler', () => {
    expect(code).not.toMatch(/action:\s*["']allow["']/);
  });
});

describe('webviews', () => {
  it('strip the preload and force isolation/sandbox on attach', () => {
    const cfg = body('configureSessions');
    const attach = cfg.slice(cfg.indexOf('will-attach-webview'));
    expect(attach).toMatch(/delete webPreferences\.preload\b/);
    expect(attach).toMatch(/webPreferences\.nodeIntegration = false/);
    expect(attach).toMatch(/webPreferences\.contextIsolation = true/);
    expect(attach).toMatch(/webPreferences\.sandbox = true/);
  });

  it('configureSessions runs before the first window is created', () => {
    const ready = code.slice(code.indexOf('app.whenReady().then('));
    expect(ready.indexOf('configureSessions()')).toBeGreaterThan(-1);
    expect(ready.indexOf('configureSessions()')).toBeLessThan(ready.indexOf('createWindow('));
  });
});

describe('permissions', () => {
  it('no session grants everything', () => {
    // The old handlers: `(_wc, _perm, callback) => callback(true)` and `() => true`.
    expect(code).not.toMatch(/callback\(true\)/);
    expect(code).not.toMatch(/setPermissionCheckHandler\(\(\)\s*=>\s*true\)/);
  });

  it('the browser, default and app sessions all go through a permission gate', () => {
    const cfg = body('configureSessions');
    expect(cfg).toMatch(/installGate\(browserSession, guestGate\)/);
    expect(cfg).toMatch(/installGate\(session\.defaultSession, guestGate\)/);
    expect(cfg).toMatch(/installGate\(session\.fromPartition\("persist:quarry"\), appGate\)/);
    expect(cfg).toMatch(/setPermissionRequestHandler/);
    expect(cfg).toMatch(/setPermissionCheckHandler/);
  });
});

describe('internal API calls authenticate', () => {
  it.each(['sendLifecycleEvent', 'triggerBundledSkillInstall'])('%s posts through postInternal with the API token', (fn) => {
    const b = body(fn);
    expect(b).toMatch(/postInternal\(/);
    expect(b).toMatch(/token:\s*API_TOKEN/);
    expect(b).not.toMatch(/http\.request\(/);
  });
});

describe('electron-builder ships these modules', () => {
  // main-web.js requires ./electron/*; missing from `files`, the packaged app
  // dies at launch with MODULE_NOT_FOUND — which nothing in dev would notice.
  it('includes electron/ (and not its tests) in the packaged files', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'));
    expect(pkg.build.files).toContain('electron/**/*.js');
    expect(pkg.build.files).toContain('!electron/**/*.test.*');
    expect(code).toMatch(/require\("\.\/electron\/[^"]+"\)/);
  });
});

describe('git:push', () => {
  it('builds its argv with pushArgs (validated, with --)', () => {
    const start = code.indexOf('ipc.handle("git:push"');
    const handler = code.slice(start, code.indexOf('\n});', start));
    expect(handler).toMatch(/pushArgs\(branch\)/);
    expect(handler).not.toMatch(/\["push",/);
  });
});
