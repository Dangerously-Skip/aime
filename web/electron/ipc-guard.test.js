import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { createIpcGuard } = require_('./ipc-guard.js');
const { isTrustedSenderUrl } = require_('./nav-policy.js');

/**
 * Every IPC channel in main — file read/write, PTY, the API token — is refused
 * unless the sender is a frame showing the app. Two halves:
 *
 *   1. the guard itself refuses an untrusted sender (driven with a registry
 *      that records handlers, and the REAL origin policy — not a stub of it)
 *   2. main-web.js registers nothing except through the guard, so a new channel
 *      cannot be added with the check forgotten
 */

const PORT = 19532;

function fakeIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
  };
}

const eventFrom = (url) => ({ senderFrame: url === null ? null : { url }, sender: {} });

function guarded() {
  const ipcMain = fakeIpcMain();
  const log = vi.fn();
  const ipc = createIpcGuard({
    ipcMain,
    isTrustedSender: (event) => isTrustedSenderUrl(event.senderFrame && event.senderFrame.url, PORT),
    log,
  });
  return { ipcMain, ipc, log };
}

describe('createIpcGuard', () => {
  it('runs the handler for the app origin', async () => {
    const { ipcMain, ipc } = guarded();
    ipc.handle('fs:read', (_e, p) => `read ${p}`);
    expect(ipcMain.handlers.get('fs:read')(eventFrom(`http://localhost:${PORT}/`), '/x')).toBe('read /x');
  });

  it.each([
    ['https://evil.example/', 'an external site the window was navigated to'],
    [`http://localhost:${PORT}.evil.com/`, 'a lookalike host'],
    ['file:///tmp/page.html', 'a local file'],
    [null, 'a frame that is already gone'],
  ])('refuses invoke() from %s (%s), without running the handler', async (url) => {
    const { ipcMain, ipc, log } = guarded();
    const handler = vi.fn(() => 'secret');
    ipc.handle('get-api-token', handler);
    await expect(async () => ipcMain.handlers.get('get-api-token')(eventFrom(url))).rejects.toThrow(/refused/);
    expect(handler).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('get-api-token'));
  });

  it('answers a refused sendSync with null instead of leaving the renderer blocked', () => {
    const { ipcMain, ipc } = guarded();
    const handler = vi.fn((e) => { e.returnValue = '1.0.0'; });
    ipc.on('get-app-version', handler);
    const event = eventFrom('https://evil.example/');
    ipcMain.listeners.get('get-app-version')(event);
    expect(handler).not.toHaveBeenCalled();
    expect(event.returnValue).toBeNull();
  });

  it('refuses when the sender check itself throws', async () => {
    const ipcMain = fakeIpcMain();
    const ipc = createIpcGuard({ ipcMain, isTrustedSender: () => { throw new Error('frame gone'); }, log: () => {} });
    ipc.handle('x', () => 1);
    await expect(async () => ipcMain.handlers.get('x')(eventFrom(`http://localhost:${PORT}/`))).rejects.toThrow();
  });

  it('a per-registration trust predicate replaces the origin check for that channel only', () => {
    const { ipcMain, ipc } = guarded();
    const setupWindow = {};
    const retry = vi.fn();
    ipc.on('setup:retry', retry, { trust: (e) => e.sender === setupWindow });
    ipcMain.listeners.get('setup:retry')({ senderFrame: { url: 'file:///setup-window.html' }, sender: setupWindow });
    expect(retry).toHaveBeenCalledTimes(1);
    // The app window itself is NOT the setup window.
    ipcMain.listeners.get('setup:retry')(eventFrom(`http://localhost:${PORT}/`));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('main-web.js registers every channel through the guard', () => {
  const src = readFileSync(path.resolve(__dirname, '..', 'main-web.js'), 'utf-8');
  // Strip comments so prose mentioning the API does not count — only where they
  // start a line, since `"*://*.google.com/*"` would otherwise open a "comment".
  const code = src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('never calls ipcMain.handle / on / once / handleOnce / addListener directly', () => {
    const raw = code.match(/ipcMain\s*\.\s*(handle|handleOnce|on|once|addListener|prependListener)\s*\(/g) || [];
    expect(raw).toEqual([]);
  });

  it('hands ipcMain to the guard exactly once', () => {
    expect(code.match(/createIpcGuard\s*\(/g)).toHaveLength(1);
  });

  it('registers every channel the preload uses', () => {
    const preload = readFileSync(path.resolve(__dirname, '..', 'preload-web.js'), 'utf-8');
    const used = new Set(
      [...preload.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    const registered = new Set([...code.matchAll(/ipc\.(?:handle|on)\(\s*"([^"]+)"/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter((c) => !registered.has(c));
    expect(missing).toEqual([]);
  });
});
