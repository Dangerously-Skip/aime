// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useBrowserStore } from './browser-store';

/*
 * `completeRunningTools` is required by `handleCoreChunk`, the shared SSE
 * reducer every other surface routes its events through. The browser store
 * lacked it because the browser surface ran its own hand-rolled loop — the same
 * reason it ended up with the weakest agent in the app.
 *
 * Adding it is the first step of routing that surface through the main chat
 * path, and it is worth its own tests: a tool stuck on "running" is how a turn
 * looks like it is still working long after it stopped.
 */

const CHAT = 'c1';

function seed(toolStatuses: Array<'running' | 'complete'>) {
  useBrowserStore.setState({
    messages: {
      [CHAT]: [
        { id: 'm1', role: 'user', content: 'go', timestamp: Date.now() },
        {
          id: 'm2',
          role: 'assistant',
          content: 'working',
          timestamp: Date.now(),
          isStreaming: true,
          isLoading: true,
          toolCalls: toolStatuses.map((status, i) => ({
            id: `t${i}`,
            name: 'navigate',
            input: {},
            status,
            startTime: Date.now(),
          })),
        },
      ],
    },
  } as never);
}

const last = () => useBrowserStore.getState().messages[CHAT].at(-1)!;

beforeEach(() => {
  useBrowserStore.setState({ messages: {} } as never);
});

describe('completeRunningTools', () => {
  it('closes tools left running', () => {
    seed(['running', 'running']);
    useBrowserStore.getState().completeRunningTools(CHAT);
    expect(last().toolCalls!.every((t) => t.status === 'complete')).toBe(true);
    expect(last().toolCalls!.every((t) => typeof t.endTime === 'number')).toBe(true);
  });

  it('clears the loading and streaming flags with them', () => {
    // Otherwise the message keeps its spinner after the tools have finished.
    seed(['running']);
    useBrowserStore.getState().completeRunningTools(CHAT);
    expect(last().isLoading).toBe(false);
    expect(last().isStreaming).toBe(false);
  });

  it('leaves already-complete tools alone', () => {
    seed(['complete']);
    const before = last();
    useBrowserStore.getState().completeRunningTools(CHAT);
    // Same object: no running tools means no state change at all, so a stream
    // of text events does not rewrite the message array on every chunk.
    expect(last()).toBe(before);
  });

  it('is a no-op for an unknown chat, rather than throwing', () => {
    expect(() => useBrowserStore.getState().completeRunningTools('nope')).not.toThrow();
  });

  it('is a no-op when the last message is the user’s', () => {
    // `turn_start` fires before the assistant message exists.
    useBrowserStore.setState({
      messages: { [CHAT]: [{ id: 'm1', role: 'user', content: 'go', timestamp: Date.now() }] },
    } as never);
    expect(() => useBrowserStore.getState().completeRunningTools(CHAT)).not.toThrow();
    expect(last().role).toBe('user');
  });

  it('only touches the LAST message', () => {
    // An earlier turn's tools are history and must not be rewritten.
    useBrowserStore.setState({
      messages: {
        [CHAT]: [
          {
            id: 'm1', role: 'assistant', content: 'earlier', timestamp: Date.now(),
            toolCalls: [{ id: 'old', name: 'click', input: {}, status: 'running', startTime: 1 }],
          },
          {
            id: 'm2', role: 'assistant', content: 'now', timestamp: Date.now(),
            toolCalls: [{ id: 'new', name: 'click', input: {}, status: 'running', startTime: 2 }],
          },
        ],
      },
    } as never);
    useBrowserStore.getState().completeRunningTools(CHAT);
    const msgs = useBrowserStore.getState().messages[CHAT];
    expect(msgs[0].toolCalls![0].status).toBe('running');
    expect(msgs[1].toolCalls![0].status).toBe('complete');
  });
});
