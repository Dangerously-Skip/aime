// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ViewerPane } from './viewer-pane';
import * as ipc from '@/lib/code-workspace/ipc';
import type { FsChangeEvent } from '@/lib/code-workspace/file-watcher';

/**
 * A tab read its file once and saved blindly. Left open while the agent edited
 * the file, it showed stale text forever — and saving a hand-edit silently
 * reverted the agent's change.
 *
 * The watcher is the seam: the real subscription needs Electron's chokidar, so
 * the test holds the listener the pane registers and fires events through it.
 * The file contents live in `disk`, read through the (mocked) IPC read.
 */

const watch = vi.hoisted(() => ({ listeners: [] as Array<(e: FsChangeEvent) => void> }));
vi.mock('@/lib/code-workspace/file-watcher', () => ({
  subscribe: vi.fn(async (_ws: string, l: (e: FsChangeEvent) => void) => {
    watch.listeners.push(l);
    return () => { watch.listeners = watch.listeners.filter((x) => x !== l); };
  }),
}));
vi.mock('@/lib/code-workspace/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/code-workspace/ipc')>()),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const WS = '/tmp/ws';
const FILE = `${WS}/a.ts`;
let disk = '';
const mockedWrite = vi.mocked(ipc.writeFile);

async function fsChange() {
  await act(async () => {
    for (const l of watch.listeners) l({ watchId: 'w1', path: FILE, kind: 'change' });
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function open() {
  render(<ViewerPane workspace={WS} forcedPath={FILE} />);
  await screen.findByTestId('code-renderer-output');
}
const shown = () => screen.getByTestId('code-renderer-output').textContent ?? '';
const editor = () => screen.getByRole('textbox') as HTMLTextAreaElement;

beforeEach(() => {
  watch.listeners = [];
  disk = 'const v = 1;\n';
  vi.mocked(ipc.readFile).mockImplementation(async () => ({ content: disk, encoding: 'utf-8' }));
  mockedWrite.mockReset();
  mockedWrite.mockImplementation(async (_p, c) => { disk = c; return { ok: true }; });
});
afterEach(cleanup);

describe('the editor follows the disk', () => {
  it('a clean tab reloads when the file changes on disk', async () => {
    await open();
    expect(shown()).toContain('v = 1');
    disk = 'const v = 2; // agent\n';
    await fsChange();
    expect(shown()).toContain('v = 2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a clean tab in edit mode takes the new content too', async () => {
    await open();
    fireEvent.click(screen.getByTitle(/Edit \(hand-edit/));
    disk = 'const v = 2;\n';
    await fsChange();
    expect(editor().value).toBe('const v = 2;\n');
  });

  it('a dirty tab is not overwritten; it asks, and Reload takes the disk', async () => {
    await open();
    fireEvent.click(screen.getByTitle(/Edit \(hand-edit/));
    fireEvent.change(editor(), { target: { value: 'const v = 99; // mine\n' } });
    disk = 'const v = 2; // agent\n';
    await fsChange();
    expect(editor().value).toContain('mine');
    expect(screen.getByRole('alert').textContent).toMatch(/changed on disk/);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(shown()).toContain('agent');
  });

  it('Keep mine keeps the draft, and the next save does not ask again', async () => {
    await open();
    fireEvent.click(screen.getByTitle(/Edit \(hand-edit/));
    fireEvent.change(editor(), { target: { value: 'mine\n' } });
    disk = 'agent\n';
    await fsChange();
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(editor().value).toBe('mine\n');

    await act(async () => { fireEvent.click(screen.getByTitle('Save (⌘S)')); });
    expect(mockedWrite).toHaveBeenCalledWith(FILE, 'mine\n');
  });
});

describe('save does not clobber a newer version', () => {
  it('refuses silently overwriting a change made since the tab loaded', async () => {
    await open();
    fireEvent.click(screen.getByTitle(/Edit \(hand-edit/));
    fireEvent.change(editor(), { target: { value: 'mine\n' } });
    // Written on disk, but no watcher event reached this tab.
    disk = 'agent\n';
    await act(async () => { fireEvent.click(screen.getByTitle('Save (⌘S)')); });
    expect(mockedWrite).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/overwrite/i);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Overwrite' })); });
    expect(mockedWrite).toHaveBeenCalledWith(FILE, 'mine\n');
  });

  it('saves straight through when the disk is unchanged', async () => {
    await open();
    fireEvent.click(screen.getByTitle(/Edit \(hand-edit/));
    fireEvent.change(editor(), { target: { value: 'mine\n' } });
    await act(async () => { fireEvent.click(screen.getByTitle('Save (⌘S)')); });
    expect(mockedWrite).toHaveBeenCalledWith(FILE, 'mine\n');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores events for other files', async () => {
    await open();
    disk = 'changed\n';
    await act(async () => {
      for (const l of watch.listeners) l({ watchId: 'w1', path: `${WS}/other.ts`, kind: 'change' });
    });
    expect(shown()).toContain('v = 1');
  });
});
