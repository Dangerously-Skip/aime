// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Terminal } from 'xterm';
import {
  TerminalContextMenu,
  preparePaste,
  runTerminalAction,
  type ClipboardLike,
} from './terminal-context-menu';

/**
 * Right-click pasted the clipboard straight into the shell whenever nothing was
 * selected — a copied `rm -rf build\n` ran on a stray right-click. Paste is an
 * explicit menu item now, and what reaches the PTY is checked against a REAL
 * xterm (its onData is exactly what the panel forwards to the PTY).
 */

afterEach(cleanup);

const clipboard = (text: string): ClipboardLike & { written: string[] } => {
  const written: string[] = [];
  return { written, readText: async () => text, writeText: async (t) => { written.push(t); } };
};

/** A real, opened xterm, recording what it would send to the PTY. */
function realTerm() {
  // jsdom has no matchMedia; xterm only uses it to watch devicePixelRatio.
  window.matchMedia ??= (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never;
  const term = new Terminal({ allowProposedApi: true });
  const host = document.createElement('div');
  document.body.appendChild(host);
  term.open(host);
  const sent: string[] = [];
  term.onData((d) => sent.push(d));
  const write = (s: string) => new Promise<void>((r) => term.write(s, r));
  return { term, sent, write };
}

describe('preparePaste', () => {
  it.each([
    ['rm -rf build\n', 'rm -rf build'],
    ['ls\r\n', 'ls'],
    ['a\nb\n\n', 'a\nb'],
    ['plain', 'plain'],
  ])('%j → %j', (input, out) => {
    expect(preparePaste(input)).toBe(out);
  });
});

describe('Paste through a real xterm', () => {
  it('a copied command with a trailing newline is typed, not run', async () => {
    const { term, sent } = realTerm();
    await runTerminalAction('paste', term, clipboard('rm -rf build\n'));
    expect(sent.join('')).toBe('rm -rf build');
    expect(sent.join('')).not.toMatch(/[\r\n]$/);
    term.dispose();
  });

  it('is bracketed when the shell enabled bracketed-paste mode', async () => {
    const { term, sent, write } = realTerm();
    await write('\x1b[?2004h');
    await runTerminalAction('paste', term, clipboard('echo one\necho two\n'));
    const out = sent.join('');
    expect(out.startsWith('\x1b[200~')).toBe(true);
    expect(out.endsWith('\x1b[201~')).toBe(true);
    term.dispose();
  });

  it('an empty clipboard sends nothing', async () => {
    const { term, sent } = realTerm();
    await runTerminalAction('paste', term, clipboard('\n'));
    expect(sent).toEqual([]);
    term.dispose();
  });
});

describe('Copy / Clear', () => {
  it('copy writes the selection and never touches the shell', async () => {
    const fake = { getSelection: () => 'hello', hasSelection: () => true, paste: vi.fn(), clear: vi.fn(), focus: vi.fn() };
    const cb = clipboard('');
    await runTerminalAction('copy', fake, cb);
    expect(cb.written).toEqual(['hello']);
    expect(fake.paste).not.toHaveBeenCalled();
  });

  it('clear clears', async () => {
    const fake = { getSelection: () => '', hasSelection: () => false, paste: vi.fn(), clear: vi.fn(), focus: vi.fn() };
    await runTerminalAction('clear', fake, clipboard('x'));
    expect(fake.clear).toHaveBeenCalled();
    expect(fake.paste).not.toHaveBeenCalled();
  });
});

describe('TerminalContextMenu', () => {
  it('offers Copy (disabled without a selection), Paste and Clear', () => {
    render(<TerminalContextMenu x={0} y={0} hasSelection={false} onAction={() => {}} onClose={() => {}} />);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent?.replace(/⌘.$/, ''))).toEqual(['Copy', 'Paste', 'Clear']);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('runs the chosen action and closes; Esc and outside clicks just close', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(<TerminalContextMenu x={0} y={0} hasSelection onAction={onAction} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Paste/ }));
    expect(onAction).toHaveBeenCalledWith('paste');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
