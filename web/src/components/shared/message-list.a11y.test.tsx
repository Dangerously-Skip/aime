// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MessageList } from './message-list';

type Msg = Parameters<typeof MessageList>[0]['messages'][number];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settled: Msg[] = [
  { id: 'u', role: 'user', content: 'hello', timestamp: 0 },
  { id: 'a', role: 'assistant', content: 'hi there', timestamp: 0 },
];

describe('MessageList accessibility', () => {
  it('is a polite live log, held busy while a reply is streaming', () => {
    const { rerender } = render(
      <MessageList messages={[...settled, { id: 'b', role: 'assistant', content: 'wri', timestamp: 0, isStreaming: true }]} />,
    );
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    // Screen readers wait for the finished reply instead of reading each token.
    expect(log.getAttribute('aria-busy')).toBe('true');

    rerender(<MessageList messages={settled} />);
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('false');
  });

  it('message actions have names and are revealed on keyboard focus, not only hover', () => {
    render(<MessageList messages={settled} conversationId="c" onRetry={() => {}} onEditMessage={() => {}} />);
    for (const name of ['Copy reply', 'Regenerate reply', 'This was helpful', 'Copy message', 'Edit and resend']) {
      const button = screen.getByRole('button', { name });
      // The hover-revealed row shows itself when anything inside it has focus.
      expect(button.closest('.focus-within\\:opacity-100'), name).not.toBeNull();
    }
  });
});
