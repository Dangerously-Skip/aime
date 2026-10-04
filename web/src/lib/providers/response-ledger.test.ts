import { describe, it, expect } from 'vitest';
import { ResponseLedger } from './response-ledger';

describe('ResponseLedger', () => {
  it('opens one segment per API response, however many frames it arrives in', () => {
    const l = new ResponseLedger('leg');
    const a = l.open('msg_1');
    expect(l.open('msg_1')).toBe(a);
    expect(l.open(undefined)).toBe(a);
    const b = l.open('msg_2');
    expect(b).not.toBe(a);
    expect(l.segment).toBe(b);
  });

  it('treats every message_start as a new response, even without an id', () => {
    const l = new ResponseLedger('leg');
    const a = l.begin(undefined);
    expect(l.begin(undefined)).not.toBe(a);
    const c = l.begin('msg_9');
    expect(l.begin('msg_9')).toBe(c);
    expect(l.open('msg_9')).toBe(c);
  });

  it('prefixes segments per query, so resume legs never collide', () => {
    expect(new ResponseLedger('a').open('m')).not.toBe(new ResponseLedger('b').open('m'));
  });

  it('turns retracted uuids into segments, their tool calls, their text — and tombstoned results', () => {
    const l = new ResponseLedger('leg');
    const kept = l.open('msg_0');
    l.noteFrame('u0', kept);
    l.noteText(kept, 'Let me look. ');
    l.noteTool(kept, 'toolu_kept');

    const refused = l.open('msg_1');
    l.noteText(refused, 'REFUSED partial');
    l.noteFrame('u1', refused);
    l.noteTool(refused, 'toolu_refused');
    l.noteFrame('u2', refused);
    l.noteToolResults('u3', ['toolu_refused']);

    expect(l.retract(['u1', 'u2', 'u3', 'unknown'])).toEqual({
      segments: [refused],
      toolUseIds: ['toolu_refused'],
      texts: ['REFUSED partial'],
    });
  });

  it('is idempotent: supersedes and the end notice naming the same messages retract once', () => {
    const l = new ResponseLedger('leg');
    const refused = l.open('msg_1');
    l.noteFrame('u1', refused);
    const replacement = l.open('msg_2');
    expect(l.retract(['u1'], replacement)?.segments).toEqual([refused]);
    expect(l.retract(['u1'])).toBeNull();
  });

  it('never retracts the superseding frame’s own segment', () => {
    const l = new ResponseLedger('leg');
    const replacement = l.open('msg_2');
    l.noteFrame('u9', replacement);
    expect(l.retract(['u9'], replacement)).toBeNull();
  });

  it('ignores anything that is not a list of uuids, as the SDK specifies', () => {
    const l = new ResponseLedger('leg');
    expect(l.retract(undefined)).toBeNull();
    expect(l.retract('u1')).toBeNull();
    expect(l.retract([42, null])).toBeNull();
  });
});
