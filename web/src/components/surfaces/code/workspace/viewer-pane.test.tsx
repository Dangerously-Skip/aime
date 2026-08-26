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
