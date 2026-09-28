import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { createServerSupervisor, loadingPageUrl } = require_('./server-supervisor.js');

/**
 * When the packaged Next server died, main logged a line and left a window whose
 * every request failed — the app looked frozen. Now: restart once, then tell the
 * user (with the log path) instead of leaving a dead window.
 */

function fakeChild() {
  const c = new EventEmitter();
  c.kill = vi.fn(() => c.emit('exit', null));
  return c;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function supervisor({ ready = () => Promise.resolve(), maxRestarts = 1 } = {}) {
  const children = [];
  const onReady = vi.fn();
  const onFatal = vi.fn();
  const sup = createServerSupervisor({
    spawn: () => {
      const c = fakeChild();
      children.push(c);
      return c;
    },
    waitReady: ready,
    onReady,
    onFatal,
    maxRestarts,
    log: () => {},
  });
  return { sup, children, onReady, onFatal };
}

describe('createServerSupervisor', () => {
  it('starts the server and reports ready', async () => {
    const { sup, children, onReady, onFatal } = supervisor();
    await sup.start();
    expect(children).toHaveLength(1);
    expect(onReady).toHaveBeenCalledWith({ restarted: false });
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('restarts once after an unexpected exit, and reports the restart as ready', async () => {
    const { sup, children, onReady, onFatal } = supervisor();
    await sup.start();
    children[0].emit('exit', 1);
    await flush();
    expect(children).toHaveLength(2);
    expect(onReady).toHaveBeenLastCalledWith({ restarted: true });
    expect(onFatal).not.toHaveBeenCalled();
    expect(sup.restarts).toBe(1);
  });

  it('gives up after maxRestarts and says so once, naming the exit code', async () => {
    const { sup, children, onFatal } = supervisor();
    await sup.start();
    children[0].emit('exit', 1);
    await flush();
    children[1].emit('exit', 137);
    await flush();
    expect(children).toHaveLength(2);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toMatch(/code 137/);
  });

  it('a server that never listens is fatal, and is killed so it cannot also trigger a restart', async () => {
    const { sup, children, onFatal, onReady } = supervisor({ ready: () => Promise.reject(new Error('Timed out waiting for port 1')) });
    await sup.start();
    expect(children[0].kill).toHaveBeenCalled();
    expect(children).toHaveLength(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toMatch(/Timed out/);
  });

  it('a deliberate stop (quitting) is not a crash — no restart, no error', async () => {
    const { sup, children, onFatal } = supervisor();
    await sup.start();
    sup.stop();
    expect(children[0].kill).toHaveBeenCalled();
    await flush();
    expect(children).toHaveLength(1);
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('a spawn that throws is fatal, not an unhandled exception', async () => {
    const onFatal = vi.fn();
    const sup = createServerSupervisor({
      spawn: () => {
        throw new Error('EACCES');
      },
      waitReady: () => Promise.resolve(),
      onReady: vi.fn(),
      onFatal,
      log: () => {},
    });
    await sup.start();
    expect(onFatal).toHaveBeenCalledWith(expect.stringMatching(/EACCES/));
  });
});

describe('loadingPageUrl', () => {
  it('is a script-free data: page naming the app', () => {
    const url = loadingPageUrl('AIME');
    expect(url.startsWith('data:text/html')).toBe(true);
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    expect(html).toContain('Starting AIME');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
  });

  it('cannot be turned into markup by the name', () => {
    const html = decodeURIComponent(loadingPageUrl('<img src=x onerror=alert(1)>').split(',').slice(1).join(','));
    expect(html).not.toContain('<img');
  });
});
