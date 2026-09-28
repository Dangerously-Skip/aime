import { describe, it, expect, vi, beforeEach } from 'vitest';

const ipc = vi.hoisted(() => ({
  watchPath: vi.fn(),
  unwatchPath: vi.fn(async () => {}),
  onFsChange: vi.fn(),
}));
vi.mock('./ipc', () => ipc);

import { subscribe } from './file-watcher';

beforeEach(() => {
  ipc.watchPath.mockReset();
  ipc.unwatchPath.mockClear();
  ipc.onFsChange.mockReset();
});

describe('subscribe — one watcher per workspace', () => {
  it('two subscribers mounting together share one watcher (the second used to leak one)', async () => {
    let n = 0;
    ipc.watchPath.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return `w${++n}`;
    });
    let emit: (e: { watchId: string; path: string; kind: 'change' }) => void = () => {};
    ipc.onFsChange.mockImplementation((cb) => { emit = cb; return () => {}; });

    const a = vi.fn();
    const b = vi.fn();
    const [offA, offB] = await Promise.all([subscribe('/ws', a), subscribe('/ws', b)]);
    expect(ipc.watchPath).toHaveBeenCalledTimes(1);

    emit({ watchId: 'w1', path: '/ws/x', kind: 'change' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    expect(ipc.unwatchPath).not.toHaveBeenCalled();
    offB();
    expect(ipc.unwatchPath).toHaveBeenCalledWith('w1');
  });

  it('no bridge → a no-op unsubscribe', async () => {
    ipc.watchPath.mockResolvedValue(null);
    const off = await subscribe('/nowhere', () => {});
    expect(() => off()).not.toThrow();
  });
});
