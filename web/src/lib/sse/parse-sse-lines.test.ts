import { describe, it, expect, vi } from 'vitest';
import { parseSSELines } from './parse-sse-lines';

/**
 * These cover the edge cases that made the duplicate dangerous: the two copies
 * of this parser could have drifted on any of them, and the chat stream and the
 * browser surface would then disagree about the same wire format.
 */

type Ev = { type: string; content?: string };

function collect(chunks: string[]): { events: Ev[]; done: number; tail: string } {
  const events: Ev[] = [];
  const done = vi.fn();
  let tail = '';
  for (const chunk of chunks) {
    tail = parseSSELines<Ev>(tail + chunk, (e) => events.push(e), done);
  }
  return { events, done: done.mock.calls.length, tail };
}

describe('parseSSELines', () => {
  it('parses complete data lines', () => {
    const { events } = collect(['data: {"type":"text","content":"a"}\ndata: {"type":"text","content":"b"}\n']);
    expect(events).toEqual([
      { type: 'text', content: 'a' },
      { type: 'text', content: 'b' },
    ]);
  });

  // The reason the function returns a string at all.
  it('holds back a trailing partial line and completes it on the next chunk', () => {
    const { events, tail } = collect(['data: {"type":"te']);
    expect(events).toHaveLength(0);
    expect(tail).toBe('data: {"type":"te');

    const whole = collect(['data: {"type":"te', 'xt","content":"split"}\n']);
    expect(whole.events).toEqual([{ type: 'text', content: 'split' }]);
    expect(whole.tail).toBe('');
  });

  it('splits an event across three chunks without losing it', () => {
    const { events } = collect(['data: {"ty', 'pe":"text","con', 'tent":"thirds"}\n']);
    expect(events).toEqual([{ type: 'text', content: 'thirds' }]);
  });

  it('skips blank lines and `:` heartbeat comments', () => {
    const { events } = collect([': keep-alive\n\ndata: {"type":"text"}\n\n: ping\n']);
    expect(events).toEqual([{ type: 'text' }]);
  });

  it('calls onDone on the sentinel and discards anything after it', () => {
    const { events, done, tail } = collect([
      'data: {"type":"text","content":"a"}\ndata: [DONE]\ndata: {"type":"text","content":"after"}\n',
    ]);
    expect(events).toEqual([{ type: 'text', content: 'a' }]);
    expect(done).toBe(1);
    expect(tail).toBe('');
  });

  // The browser agent ends on stream close, not on the sentinel — it passes no
  // callback, and must not throw when one arrives.
  it('tolerates a missing onDone', () => {
    const events: Ev[] = [];
    expect(() => parseSSELines<Ev>('data: [DONE]\n', (e) => events.push(e))).not.toThrow();
    expect(parseSSELines<Ev>('data: [DONE]\n', (e) => events.push(e))).toBe('');
  });

  it('drops an unparseable line and keeps going', () => {
    const { events } = collect(['data: {not json\ndata: {"type":"text","content":"survived"}\n']);
    expect(events).toEqual([{ type: 'text', content: 'survived' }]);
  });

  it('ignores non-data fields', () => {
    const { events } = collect(['event: message\nid: 7\ndata: {"type":"text"}\n']);
    expect(events).toEqual([{ type: 'text' }]);
  });

  it('handles an empty buffer', () => {
    expect(collect([''])).toMatchObject({ events: [], tail: '' });
  });

  // `data:foo` with no space is valid SSE.
  it('accepts a data line with no space after the colon', () => {
    const { events } = collect(['data:{"type":"text","content":"tight"}\n']);
    expect(events).toEqual([{ type: 'text', content: 'tight' }]);
  });
});
