// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ViewerPane } from './viewer-pane';
import { useCodeWorkspaceStore } from '@/stores/code-workspace-store';
import * as ipc from '@/lib/code-workspace/ipc';

/**
 * The file viewer's toolbar is the visible door to the diff pipeline.
 *
 * The diff stack has been complete since Phase 2 — git:diff IPC, DiffViewer,
 * alt-click in the tree, the M-badge — but every entry point was a gesture
 * nobody could discover, so the answer to "I would like a diff view of code"
 * was "it already exists, if you happen to Option-click". The toolbar button
 * calls the exact same __ideOpenDiff hook the tree's alt-click does; this test
 * pins that wiring, including the fallback to a store diff tab when the
 * dockview bridge is absent (legacy single-pane layout).
 */

vi.mock('@/lib/code-workspace/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/code-workspace/ipc')>()),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const mockedRead = vi.mocked(ipc.readFile);

const WS = '/tmp/workspace';

function setActiveFile(path: string) {
  useCodeWorkspaceStore.setState((s) => ({
    byWorkspace: {
      ...s.byWorkspace,
      [WS]: {
        ...(s.byWorkspace[WS] ?? {}),
        openTabs: [{ id: path, kind: 'file', path, pinned: false }],
        activeTabId: path,
      },
    },
  }) as unknown as Partial<typeof s>);
}

beforeEach(() => {
  useCodeWorkspaceStore.setState({ byWorkspace: {} } as never);
  mockedRead.mockResolvedValue({ content: 'const x = 1;\n', encoding: 'utf-8' });
});

afterEach(cleanup);

describe('ViewerPane — the diff button', () => {
  it('opens the dockview diff panel for the open file', async () => {
    const ideOpenDiff = vi.fn();
    (window as unknown as Record<string, unknown>).__ideOpenDiff = ideOpenDiff;
    setActiveFile(`${WS}/src/a.ts`);
    render(<ViewerPane workspace={WS} />);
    await screen.findByTestId('code-renderer-output');

    fireEvent.click(screen.getByTitle(/Diff vs HEAD/));
    expect(ideOpenDiff).toHaveBeenCalledWith(`${WS}/src/a.ts`);
    delete (window as unknown as Record<string, unknown>).__ideOpenDiff;
  });

  it('falls back to a store diff tab when the dockview bridge is absent', async () => {
    setActiveFile(`${WS}/src/b.ts`);
    render(<ViewerPane workspace={WS} />);
    await screen.findByTestId('code-renderer-output');

    fireEvent.click(screen.getByTitle(/Diff vs HEAD/));
    const layout = useCodeWorkspaceStore.getState().byWorkspace[WS];
    const diffTab = layout.openTabs.find((t) => t.kind === 'diff');
    expect(diffTab?.path).toBe(`${WS}/src/b.ts`);
  });
});

describe('ViewerPane — ⌘S / ⌘F reach only the focused tab', () => {
  /*
   * Each open file tab mounts its own pane. When these were `window`
   * listeners, ⌘S saved EVERY tab in edit mode and ⌘F opened a find bar in all
   * of them, from any surface.
   */
  const mockedWrite = vi.mocked(ipc.writeFile);

  async function openTwoEditing() {
    mockedWrite.mockReset();
    mockedWrite.mockResolvedValue({ ok: true });
    render(
      <>
        <ViewerPane workspace={WS} forcedPath={`${WS}/a.ts`} />
        <ViewerPane workspace={WS} forcedPath={`${WS}/b.ts`} />
      </>,
    );
    expect(await screen.findAllByTestId('code-renderer-output')).toHaveLength(2);
    for (const btn of screen.getAllByTitle(/Edit \(hand-edit/)) fireEvent.click(btn);
    // Make both dirty so either could be saved.
    for (const ta of screen.getAllByRole('textbox')) fireEvent.change(ta, { target: { value: 'changed' } });
    return screen.getAllByTestId('file-editor');
  }

  it('⌘S in one pane saves that file only', async () => {
    const [, paneB] = await openTwoEditing();
    fireEvent.keyDown(paneB, { key: 's', metaKey: true });
    await vi.waitFor(() => expect(mockedWrite).toHaveBeenCalledTimes(1));
    expect(mockedWrite.mock.calls[0][0]).toBe(`${WS}/b.ts`);
  });

  it('⌘S on the window (focus elsewhere) saves nothing', async () => {
    await openTwoEditing();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('⌘F opens find in the focused pane only', async () => {
    render(
      <>
        <ViewerPane workspace={WS} forcedPath={`${WS}/a.ts`} />
        <ViewerPane workspace={WS} forcedPath={`${WS}/b.ts`} />
      </>,
    );
    await screen.findAllByTestId('code-renderer-output');
    const [paneA] = screen.getAllByTestId('file-editor');
    fireEvent.keyDown(paneA, { key: 'f', metaKey: true });
    expect(screen.getAllByPlaceholderText('Find…')).toHaveLength(1);
  });
});
