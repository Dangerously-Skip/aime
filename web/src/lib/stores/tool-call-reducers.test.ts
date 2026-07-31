import { describe, it, expect } from 'vitest';
import { withToolCall, withToolResult } from './tool-call-reducers';
import type { ToolCall } from '@/stores/chat-store';

/**
 * These two reducers existed twice, byte-identical, in `browser-store` and
 * `code-store` — and were tested in neither. Each assertion below is a decision
 * both copies encoded and either could have lost.
 */

type Msg = { role: string; content: string; toolCalls?: ToolCall[] };

const call = (id: string): ToolCall =>
  ({ id, name: 'navigate', input: {}, status: 'running', startTime: 1 }) as ToolCall;

const assistant = (toolCalls?: ToolCall[]): Msg => ({ role: 'assistant', content: '', toolCalls });
const user = (): Msg => ({ role: 'user', content: 'hi' });

describe('withToolCall', () => {
  it('appends to the last assistant message', () => {
    const next = withToolCall({ c: [user(), assistant()] }, 'c', call('t1'));
    expect(next!.c[1].toolCalls).toHaveLength(1);
    expect(next!.c[1].toolCalls![0].id).toBe('t1');
  });

  it('keeps existing tool calls', () => {
    const next = withToolCall({ c: [assistant([call('t1')])] }, 'c', call('t2'));
    expect(next!.c[0].toolCalls!.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  // A no-op, never a throw: these run inside a streaming handler, where an
  // exception costs the rest of the turn.
  it('returns null rather than throwing when the last message is the user’s', () => {
    expect(withToolCall({ c: [assistant(), user()] }, 'c', call('t1'))).toBeNull();
  });

  it('returns null for an unknown or empty chat', () => {
    expect(withToolCall({}, 'nope', call('t1'))).toBeNull();
    expect(withToolCall({ c: [] }, 'c', call('t1'))).toBeNull();
  });

  /**
   * Identity is what drives the re-render. Mutating in place leaves zustand
   * believing nothing changed and the UI stale — the bug this shape prevents.
   */
  it('returns new references and mutates nothing', () => {
    const before = { c: [assistant()] };
    const snapshot = JSON.stringify(before);
    const next = withToolCall(before, 'c', call('t1'))!;

    expect(next).not.toBe(before);
    expect(next.c).not.toBe(before.c);
    expect(next.c[0]).not.toBe(before.c[0]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('leaves other chats untouched', () => {
    const before = { a: [assistant()], b: [assistant()] };
    const next = withToolCall(before, 'a', call('t1'))!;
    expect(next.b).toBe(before.b);
  });
});

describe('withToolResult', () => {
  it('records output and completes the matching call', () => {
    const next = withToolResult({ c: [assistant([call('t1')])] }, 'c', 't1', 'done', false, 99)!;
    expect(next.c[0].toolCalls![0]).toMatchObject({
      output: 'done',
      status: 'complete',
      endTime: 99,
    });
  });

  it('marks an errored call as error, not complete', () => {
    const next = withToolResult({ c: [assistant([call('t1')])] }, 'c', 't1', 'boom', true, 99)!;
    expect(next.c[0].toolCalls![0].status).toBe('error');
  });

  it('updates only the matching call', () => {
    const next = withToolResult(
      { c: [assistant([call('t1'), call('t2')])] },
      'c',
      't2',
      'done',
      false,
      99,
    )!;
    expect(next.c[0].toolCalls![0].status).toBe('running');
    expect(next.c[0].toolCalls![1].status).toBe('complete');
  });

  it('is a no-op for an id that is not there', () => {
    const next = withToolResult({ c: [assistant([call('t1')])] }, 'c', 'nope', 'x', false, 99)!;
    expect(next.c[0].toolCalls![0].status).toBe('running');
  });

  it('returns null when the last message has no tool calls at all', () => {
    expect(withToolResult({ c: [assistant()] }, 'c', 't1', 'x', false, 99)).toBeNull();
    expect(withToolResult({ c: [user()] }, 'c', 't1', 'x', false, 99)).toBeNull();
    expect(withToolResult({}, 'c', 't1', 'x', false, 99)).toBeNull();
  });

  it('returns new references and mutates nothing', () => {
    const before = { c: [assistant([call('t1')])] };
    const snapshot = JSON.stringify(before);
    const next = withToolResult(before, 'c', 't1', 'done', false, 99)!;

    expect(next.c[0].toolCalls).not.toBe(before.c[0].toolCalls);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
