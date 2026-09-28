// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as ipc from '@/lib/code-workspace/ipc';
import { detectDefaultBranch } from './default-branch';
import { DiffViewer } from './diff-viewer';

vi.mock('@/lib/code-workspace/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/code-workspace/ipc')>()),
  getGitDiff: vi.fn(async () => ''),
  getGitBranches: vi.fn(async () => []),
  getGitStatus: vi.fn(async () => null),
}));

describe('detectDefaultBranch', () => {
  it('prefers origin/HEAD (reported as baseBranch when there is no upstream)', () => {
    expect(detectDefaultBranch({ baseBranch: 'origin/trunk', currentBranch: 'feat', branches: ['feat', 'main'] }))
      .toBe('origin/trunk');
  });

  it('ignores baseBranch when it is just this branch’s own upstream', () => {
    expect(detectDefaultBranch({ baseBranch: 'origin/feat', currentBranch: 'feat', branches: ['feat', 'master'] }))
      .toBe('master');
  });

  it.each([
    [['feat', 'main', 'master'], 'main'],
    [['feat', 'master', 'develop'], 'master'],
    [['feat', 'develop'], 'develop'],
    [['feat', 'origin/master'], 'origin/master'],
    [['main', 'origin/master'], 'main'],
  ])('%j → %s', (branches, expected) => {
    expect(detectDefaultBranch({ branches })).toBe(expected);
  });

  it('null when nothing matches — no guess', () => {
    expect(detectDefaultBranch({ branches: ['feat', 'wip'] })).toBeNull();
    expect(detectDefaultBranch({ baseBranch: 'noslash', branches: [] })).toBeNull();
  });
});

describe('DiffViewer — HEAD vs base branch', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.mocked(ipc.getGitDiff).mockClear();
    vi.mocked(ipc.getGitBranches).mockResolvedValue(['feat', 'master', 'release']);
    vi.mocked(ipc.getGitStatus).mockResolvedValue({ branch: 'feat', baseBranch: 'origin/feat', ahead: 0, behind: 0, files: [] });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('compares against the detected default, not a hardcoded main', async () => {
    render(<DiffViewer workspace="/ws" filePath="/ws/a.ts" />);
    await waitFor(() => expect(ipc.getGitBranches).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByLabelText('Diff mode') as HTMLSelectElement).options.length).toBe(3));
    // Let detection land before picking the mode.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(screen.getByLabelText('Diff mode'), { target: { value: 'head-vs-base' } });
    await waitFor(() =>
      expect(ipc.getGitDiff).toHaveBeenLastCalledWith('/ws', { path: '/ws/a.ts', fromRef: 'master', toRef: 'HEAD' }),
    );
  });

  it('lets the user pick another base', async () => {
    render(<DiffViewer workspace="/ws" filePath="/ws/a.ts" />);
    await waitFor(() => expect(ipc.getGitStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.change(screen.getByLabelText('Diff mode'), { target: { value: 'head-vs-base' } });
    const base = await screen.findByLabelText('Base branch');
    expect((base as HTMLSelectElement).value).toBe('master');
    fireEvent.change(base, { target: { value: 'release' } });
    await waitFor(() =>
      expect(ipc.getGitDiff).toHaveBeenLastCalledWith('/ws', { path: '/ws/a.ts', fromRef: 'release', toRef: 'HEAD' }),
    );
  });

  it('no base picker in working-tree mode', async () => {
    render(<DiffViewer workspace="/ws" filePath="/ws/a.ts" />);
    await waitFor(() => expect(ipc.getGitDiff).toHaveBeenCalled());
    expect(screen.queryByLabelText('Base branch')).toBeNull();
  });
});
