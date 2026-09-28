// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MessageList } from './message-list';
import { artifactsOf } from '@/components/surfaces/chat/artifacts-of';
import { artifactsFromMessages } from '@/lib/artifact-tracker';

/** Count markdown renders — the expensive part of a message row. */
const renders: string[] = [];
vi.mock('./markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => {
    renders.push(content);
    return <div>{content}</div>;
  },
}));

type Msg = Parameters<typeof MessageList>[0]['messages'][number];

beforeEach(() => {
  renders.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MessageList — a streaming token re-renders only the streaming reply', () => {
  it('leaves settled rows alone', () => {
    const settled: Msg[] = [
      { id: 'u1', role: 'user', content: 'q1', timestamp: 0 },
      { id: 'a1', role: 'assistant', content: 'answer one', timestamp: 0 },
      { id: 'u2', role: 'user', content: 'q2', timestamp: 0 },
    ];
    const streaming = (content: string): Msg => ({ id: 'a2', role: 'assistant', content, timestamp: 0, isStreaming: true });
    const onRetry = vi.fn();
    const { rerender } = render(<MessageList messages={[...settled, streaming('t')]} conversationId="c" onRetry={onRetry} />);
    renders.length = 0;

    rerender(<MessageList messages={[...settled, streaming('to')]} conversationId="c" onRetry={onRetry} />);
    rerender(<MessageList messages={[...settled, streaming('tok')]} conversationId="c" onRetry={onRetry} />);

    expect(renders).toEqual(['to', 'tok']);
  });

  it('offers Retry on the last settled reply only', () => {
    const msgs: Msg[] = [
      { id: 'u1', role: 'user', content: 'q1', timestamp: 0 },
      { id: 'a1', role: 'assistant', content: 'one', timestamp: 0 },
      { id: 'u2', role: 'user', content: 'q2', timestamp: 0 },
      { id: 'a2', role: 'assistant', content: 'two', timestamp: 0 },
      // A question card after the reply does not take its place.
      { id: 'q', role: 'assistant', content: '', timestamp: 0, questionData: [{ question: 'Which?', options: [] }] },
    ];
    render(<MessageList messages={msgs} conversationId="c" onRetry={() => {}} />);
    expect(screen.getAllByTitle('Retry')).toHaveLength(1);
  });
});

describe('artifactsOf', () => {
  const tc = (name: string, input: Record<string, unknown>) => ({
    id: name + JSON.stringify(input), name, input, status: 'complete' as const, startTime: 0,
  });

  it('matches artifactsFromMessages, in order', () => {
    const msgs = [
      { toolCalls: [tc('Write', { file_path: '/w/a.md' }), tc('Bash', { command: 'python make.py > /w/out.pptx' })] },
      { toolCalls: [] },
      { toolCalls: [tc('Write', { file_path: '/w/a.md' }), tc('Edit', { file_path: '/w/b.ts' })] },
    ];
    expect(artifactsOf(msgs as never)).toEqual(artifactsFromMessages(msgs as never));
  });

  it('does not rescan a message it has already seen', () => {
    const toolCalls = [tc('Write', { file_path: '/w/a.md' })];
    const m = { toolCalls };
    artifactsOf([m] as never);
    // Mutating in place is not something the store does — it proves the cache hit.
    toolCalls.push(tc('Write', { file_path: '/w/new.md' }));
    expect(artifactsOf([m] as never)).toEqual(['/w/a.md']);
  });
});
