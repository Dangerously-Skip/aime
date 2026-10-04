// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { AssistantMessage } from './assistant-message';
import { describeToolProgress } from '@/lib/tool-activity';
import { useChatStore, type Message } from '@/stores/chat-store';
import { handleCoreChunk } from '@/lib/sse/core-chunks';

/**
 * A reply renders in the order it happened.
 *
 * Every tool call collapsed into one bar above the whole reply, so the text
 * that introduced them — "Let me search for that…" — appeared AFTER the
 * searches it announced. Calls now carry where in the text they were made.
 */

afterEach(cleanup);

const tool = (id: string, name: string, textOffset?: number) => ({
  id,
  name,
  input: { pattern: id },
  status: 'complete' as const,
  startTime: 1,
  endTime: 2,
  ...(textOffset === undefined ? {} : { textOffset }),
});

/** Where each needle first appears in the rendered text. */
function order(container: HTMLElement, needles: string[]): number[] {
  const text = container.textContent ?? '';
  return needles.map((n) => text.indexOf(n));
}

describe('AssistantMessage — tool calls sit where they were made', () => {
  it('text, the tools it introduced, then the text that followed', () => {
    const content = 'Let me search for that.\n\nFound it in two files.\n\nHere is the answer.';
    const after = (s: string) => content.indexOf(s) + s.length;
    const first = [tool('a', 'Grep', after('Let me search for that.'))];
    const second = [tool('b', 'Read', after('two files.')), tool('c', 'Read', after('two files.'))];
    const { container } = render(<AssistantMessage content={content} toolCalls={[...first, ...second]} />);

    const positions = order(container, [
      'Let me search for that.',
      describeToolProgress(first),
      'Found it in two files.',
      describeToolProgress(second),
      'Here is the answer.',
    ]);
    expect(positions.every((p) => p >= 0), `missing: ${positions}`).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it('a transcript from before offsets renders as it always did: one bar, then the text', () => {
    const calls = [tool('a', 'Grep'), tool('b', 'Read')];
    const { container } = render(<AssistantMessage content="Let me look. Done." toolCalls={calls} />);
    const [bar, text] = order(container, [describeToolProgress(calls), 'Let me look.']);
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(bar).toBeLessThan(text);
  });

  it('artifacts and canvas chips render once, not once per segment', () => {
    const content = 'Drafting.\n\n:::artifact{type="markdown" title="Plan"}\n# Plan\n:::\n\nThere you go.';
    render(
      <AssistantMessage
        content={content}
        toolCalls={[tool('a', 'Grep', 9)]}
        inlineCanvases={[{ id: 'cv', title: 'Quarterly chart', doc: { components: [] } as never }]}
      />,
    );
    expect(screen.getAllByText('Quarterly chart')).toHaveLength(1);
    expect(screen.getAllByText('Plan').length).toBeLessThanOrEqual(1);
  });
});

/*
 * The offset is recorded client-side as the stream arrives, by the store the
 * shared chunk handler writes to — so every surface gets it, whatever path
 * recorded the call.
 */
describe('the stream records where each call was made', () => {
  it('text → tool → text places the tool after the first text', () => {
    const CHAT = 'interleave-1';
    const s = useChatStore.getState();
    s.clearMessages(CHAT);
    s.addMessage(CHAT, { id: 'r', role: 'assistant', content: '', timestamp: 1, isStreaming: true } as Message);
    const ctx = {
      chatId: CHAT,
      store: useChatStore.getState(),
      printDocument: () => {},
      onCanvas: () => {},
    };
    handleCoreChunk({ type: 'text', content: 'Let me search.' }, ctx);
    handleCoreChunk({ type: 'tool_use', id: 't1', name: 'Grep', input: {} }, ctx);
    handleCoreChunk({ type: 'tool_use', id: 't2', name: 'Grep', input: {} }, ctx);
    handleCoreChunk({ type: 'text', content: 'Found it.' }, ctx);

    const reply = useChatStore.getState().messages[CHAT].at(-1)!;
    expect(reply.toolCalls?.map((t) => t.textOffset)).toEqual([14, 14]);
    expect(reply.content.slice(0, 14)).toBe('Let me search.');
    expect(reply.content.slice(14).trim()).toBe('Found it.');
  });

  it('keeps an offset the caller already knows', () => {
    const CHAT = 'interleave-2';
    const s = useChatStore.getState();
    s.clearMessages(CHAT);
    s.addMessage(CHAT, { id: 'r', role: 'assistant', content: 'abcdef', timestamp: 1 } as Message);
    s.addToolCall(CHAT, { id: 't', name: 'X', input: {}, status: 'running', startTime: 1, textOffset: 2 });
    expect(useChatStore.getState().messages[CHAT].at(-1)!.toolCalls![0].textOffset).toBe(2);
  });
});
