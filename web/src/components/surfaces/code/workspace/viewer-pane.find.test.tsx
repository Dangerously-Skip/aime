// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ViewerPane } from './viewer-pane';
import { useCodeWorkspaceStore } from '@/stores/code-workspace-store';
import * as ipc from '@/lib/code-workspace/ipc';
import { FIND_HIGHLIGHT, FIND_HIGHLIGHT_CURRENT } from './find-in-pane';

/**
 * ⌘F in the Code viewer opened a find bar whose query nothing read: type in
 * it and nothing was counted, painted or scrolled to. These drive the real
 * pane — real renderer, real overlay editor — and read the result off the
 * highlight registry the CSS paints from.
 */

vi.mock('@/lib/code-workspace/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/code-workspace/ipc')>()),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const WS = '/tmp/workspace';
const FILE = `${WS}/src/a.ts`;
const SOURCE = 'const total = 1;\nfunction addTotal(n) {\n  return total + n;\n}\n';

class FakeHighlight {
  ranges: Range[];
  constructor(...r: Range[]) {
    this.ranges = r;
  }
}
const registry = new Map<string, FakeHighlight>();
const g = globalThis as unknown as Record<string, unknown>;
let saved: { CSS: unknown; Highlight: unknown };

const painted = (name: string) => (registry.get(name)?.ranges ?? []).map((r) => r.toString());

beforeEach(() => {
  saved = { CSS: g.CSS, Highlight: g.Highlight };
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  registry.clear();
  useCodeWorkspaceStore.setState({ byWorkspace: {} } as never);
  vi.mocked(ipc.readFile).mockResolvedValue({ content: SOURCE, encoding: 'utf-8' });
});

afterEach(() => {
  cleanup();
  g.CSS = saved.CSS;
  g.Highlight = saved.Highlight;
});

async function openFile() {
  render(<ViewerPane workspace={WS} forcedPath={FILE} />);
  await screen.findByTestId('code-renderer-output');
  const pane = screen.getByTestId('file-editor');
  fireEvent.keyDown(pane, { key: 'f', metaKey: true });
  return screen.getByLabelText('Find in file') as HTMLInputElement;
}

describe('ViewerPane — find in file', () => {
  it('counts and paints every match, case-insensitively, and marks the current one', async () => {
    const input = await openFile();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'total' } });

    await waitFor(() => expect(screen.getByTestId('find-count').textContent).toBe('1 of 3'));
    // The count and the paint come from separate effects; under load the paint
    // can land a tick after the count, so wait for it rather than assume order.
    await waitFor(() =>
      expect(painted(FIND_HIGHLIGHT).map((s) => s.toLowerCase())).toEqual(['total', 'total', 'total']),
    );
    expect(painted(FIND_HIGHLIGHT_CURRENT)).toEqual(['total']);
  });

  it('steps with Enter, Shift+Enter and the arrows, wrapping at both ends', async () => {
    const input = await openFile();
    fireEvent.change(input, { target: { value: 'total' } });
    await waitFor(() => expect(screen.getByTestId('find-count').textContent).toBe('1 of 3'));

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('find-count').textContent).toBe('2 of 3');
    // The current highlight moved to the second match, `addTotal`'s "Total".
    expect(painted(FIND_HIGHLIGHT_CURRENT)).toEqual(['Total']);

    fireEvent.click(screen.getByLabelText('Next match'));
    fireEvent.click(screen.getByLabelText('Next match'));
    expect(screen.getByTestId('find-count').textContent).toBe('1 of 3');

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByTestId('find-count').textContent).toBe('3 of 3');
  });

  it('says so when nothing matches, and clears the paint when closed', async () => {
    const input = await openFile();
    fireEvent.change(input, { target: { value: 'nowhere' } });
    await waitFor(() => expect(screen.getByTestId('find-count').textContent).toBe('No results'));
    expect(screen.getByLabelText('Next match')).toHaveProperty('disabled', true);

    fireEvent.change(input, { target: { value: 'total' } });
    await waitFor(() => expect(painted(FIND_HIGHLIGHT)).toHaveLength(3));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Find in file')).toBeNull();
    await waitFor(() => expect(registry.size).toBe(0));
  });

  it('in edit mode, finds in the live draft and Esc leaves the match selected in the textarea', async () => {
    render(<ViewerPane workspace={WS} forcedPath={FILE} />);
    await screen.findByTestId('code-renderer-output');
    fireEvent.click(screen.getByTitle('Edit (hand-edit this file)'));
    const ta = (await screen.findByTestId('code-editor-input')) as HTMLTextAreaElement;

    // An edit the find must see — not the stale initial copy React leaves as
    // the textarea's text child, which would double-count.
    fireEvent.change(ta, { target: { value: `${SOURCE}// total again\n` } });

    fireEvent.keyDown(ta, { key: 'f', metaKey: true });
    const input = screen.getByLabelText('Find in file') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'total' } });
    await waitFor(() => expect(screen.getByTestId('find-count').textContent).toBe('1 of 4'));

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); // → the new, last one
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(document.activeElement).toBe(ta);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('total');
    expect(ta.selectionStart).toBe(ta.value.lastIndexOf('total'));
  });

  it('seeds the query from a single-line selection in the editor', async () => {
    render(<ViewerPane workspace={WS} forcedPath={FILE} />);
    await screen.findByTestId('code-renderer-output');
    fireEvent.click(screen.getByTitle('Edit (hand-edit this file)'));
    const ta = (await screen.findByTestId('code-editor-input')) as HTMLTextAreaElement;
    ta.focus();
    const at = SOURCE.indexOf('addTotal');
    ta.setSelectionRange(at, at + 'addTotal'.length);

    fireEvent.keyDown(ta, { key: 'f', metaKey: true });

    expect((screen.getByLabelText('Find in file') as HTMLInputElement).value).toBe('addTotal');
    await waitFor(() => expect(screen.getByTestId('find-count').textContent).toBe('1 of 1'));
  });
});
