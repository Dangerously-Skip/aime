// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MessageList } from './message-list';

type Msg = Parameters<typeof MessageList>[0]['messages'][number];

const msg = (id: string, role: 'user' | 'assistant', content = id): Msg => ({ id, role, content, timestamp: 0 });

let scrolls = 0;

beforeEach(() => {
  scrolls = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
  Element.prototype.scrollIntoView = () => { scrolls++; };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Scroll the list up, the way reading back through a long reply does. */
function scrollUp(container: HTMLElement) {
  const list = container.firstElementChild as HTMLElement;
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 500 });
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 100 });
  fireEvent.scroll(list);
}

describe('MessageList scrolling', () => {
  it('jumps to the bottom when switching between two conversations that both have messages', () => {
    const a = [msg('a1', 'user'), msg('a2', 'assistant')];
    const b = [msg('b1', 'user'), msg('b2', 'assistant')];
    const { rerender, container } = render(<MessageList messages={a} conversationId="A" />);
    scrollUp(container);
    expect(screen.getByText('Scroll to bottom')).toBeTruthy();
    const before = scrolls;

    rerender(<MessageList messages={b} conversationId="B" />);
    expect(scrolls).toBeGreaterThan(before);
    expect(screen.queryByText('Scroll to bottom')).toBeNull();
  });

  it('follows the user down when they send while scrolled up', () => {
    const msgs = [msg('u1', 'user'), msg('r1', 'assistant')];
    const { rerender, container } = render(<MessageList messages={msgs} conversationId="A" />);
    scrollUp(container);
    const before = scrolls;

    rerender(<MessageList messages={[...msgs, msg('u2', 'user', 'next question')]} conversationId="A" />);
    expect(scrolls).toBeGreaterThan(before);
    expect(screen.queryByText('Scroll to bottom')).toBeNull();
  });

  it('does not yank a reader down while the assistant is still writing', () => {
    const msgs = [msg('u1', 'user'), msg('r1', 'assistant', 'partial')];
    const { rerender, container } = render(<MessageList messages={msgs} conversationId="A" />);
    scrollUp(container);
    const before = scrolls;

    rerender(<MessageList messages={[msgs[0], msg('r1', 'assistant', 'partial and more')]} conversationId="A" />);
    expect(scrolls).toBe(before);
    expect(screen.getByText('Scroll to bottom')).toBeTruthy();
  });
});
