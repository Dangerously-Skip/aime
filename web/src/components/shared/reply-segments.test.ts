import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { segmentReply, type ReplySegment } from './reply-segments';

type Call = { id: string; textOffset?: number };

const texts = (segments: ReplySegment<Call>[] | null) =>
  (segments ?? []).flatMap((s) => (s.kind === 'text' ? [s.text] : []));
const shape = (segments: ReplySegment<Call>[] | null) =>
  (segments ?? []).map((s) => (s.kind === 'text' ? s.text.trim() : s.tools.map((t) => t.id).join('+')));

describe('segmentReply', () => {
  it('puts each tool call where it was made in the text', () => {
    const content = 'Let me search for that.\n\nFound two results.';
    const segments = segmentReply(content, [{ id: 'search', textOffset: 'Let me search for that.'.length }]);
    expect(shape(segments)).toEqual(['Let me search for that.', 'search', 'Found two results.']);
  });

  it('groups calls with no text between them, and leads with calls made before any text', () => {
    const content = 'Reading both.\n\nDone.';
    const segments = segmentReply(content, [
      { id: 'a', textOffset: 0 },
      { id: 'b', textOffset: 'Reading both.'.length },
      { id: 'c', textOffset: 'Reading both.'.length },
    ]);
    expect(shape(segments)).toEqual(['a', 'Reading both.', 'b+c', 'Done.']);
  });

  it('a reply still running a tool ends with the group', () => {
    expect(shape(segmentReply('Let me check.', [{ id: 't', textOffset: 13 }]))).toEqual(['Let me check.', 't']);
  });

  it('renders the old way when there is nothing to place', () => {
    expect(segmentReply('Just text.', [])).toBeNull();
    // A transcript from before offsets were recorded: one bar, as it always was.
    expect(segmentReply('Old reply.', [{ id: 'x' }])).toBeNull();
    expect(segmentReply('Mixed.', [{ id: 'x', textOffset: 0 }, { id: 'y' }])).toBeNull();
  });

  it('clamps offsets that point past the text or backwards', () => {
    const segments = segmentReply('abc', [
      { id: 'late', textOffset: 99 },
      { id: 'back', textOffset: 1 },
    ]);
    expect(shape(segments)).toEqual(['abc', 'late+back']);
  });

  it('keys a growing text segment by where it starts, so streaming does not remount it', () => {
    const before = segmentReply('Hi.\n\nPart', [{ id: 't', textOffset: 3 }])!;
    const after = segmentReply('Hi.\n\nPart two, longer', [{ id: 't', textOffset: 3 }])!;
    expect(before.map((s) => s.key)).toEqual(after.map((s) => s.key));
  });

  /*
   * Whatever the offsets: every call appears exactly once, in order; the text
   * is all there and in order (only whitespace between calls is dropped); and
   * no two segments of the same kind are adjacent.
   */
  it('loses nothing and reorders nothing, for any text and offsets', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        fc.array(fc.integer({ min: -5, max: 80 }), { maxLength: 8 }),
        (content, offsets) => {
          const calls = offsets.map((o, i) => ({ id: `c${i}`, textOffset: o }));
          const segments = segmentReply(content, calls);
          if (calls.length === 0) return segments === null;
          const ids = segments!.flatMap((s) => (s.kind === 'tools' ? s.tools.map((t) => t.id) : []));
          expect(ids).toEqual(calls.map((c) => c.id));
          expect(texts(segments).join('').replace(/\s/g, '')).toBe(content.replace(/\s/g, ''));
          for (let i = 1; i < segments!.length; i++) {
            expect(segments![i].kind).not.toBe(segments![i - 1].kind);
          }
          return true;
        },
      ),
    );
  });
});
