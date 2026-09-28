import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const { createSetupBridge } = require('./setup-preload.js');

/** A stand-in ipcRenderer that records sends and lets the test emit events. */
function fakeIpc() {
  const listeners = new Map();
  return {
    sent: [],
    on(channel, fn) {
      listeners.set(channel, fn);
    },
    send(channel, ...args) {
      this.sent.push([channel, ...args]);
    },
    emit(channel, ...args) {
      listeners.get(channel)?.({ sender: { secret: 'webContents' } }, ...args);
    },
  };
}

describe('the setup window bridge', () => {
  it('exposes exactly the four calls the page uses', () => {
    expect(Object.keys(createSetupBridge(fakeIpc())).sort()).toEqual(['onError', 'onProgress', 'retry', 'skip']);
  });

  it('forwards progress without the IPC event, and only the known fields', () => {
    const ipc = fakeIpc();
    const onProgress = vi.fn();
    createSetupBridge(ipc).onProgress(onProgress);
    ipc.emit('setup:progress', { detail: 'Downloading…', percent: 0.5, extra: () => 'x' });
    expect(onProgress).toHaveBeenCalledWith({ detail: 'Downloading…', percent: 0.5 });
    expect(onProgress.mock.calls[0]).toHaveLength(1);
  });

  it('forwards an error as text', () => {
    const ipc = fakeIpc();
    const onError = vi.fn();
    createSetupBridge(ipc).onError(onError);
    ipc.emit('setup:error', new Error('HTTP 503'));
    expect(onError).toHaveBeenCalledWith('Error: HTTP 503');
  });

  it('retry and skip send their channels with no payload', () => {
    const ipc = fakeIpc();
    const bridge = createSetupBridge(ipc);
    bridge.retry();
    bridge.skip();
    expect(ipc.sent).toEqual([['setup:retry'], ['setup:skip']]);
  });

  it('requires nothing but electron, so it can run sandboxed', () => {
    const src = readFileSync(path.join(__dirname, 'setup-preload.js'), 'utf-8');
    const requires = [...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    expect([...new Set(requires)]).toEqual(['electron']);
  });
});
