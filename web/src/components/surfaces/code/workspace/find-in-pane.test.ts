// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  FIND_HIGHLIGHT,
  FIND_HIGHLIGHT_CURRENT,
  clearPaneHighlights,
  findMatches,
  rangesFor,
  setPaneHighlights,
  textSegments,
} from './find-in-pane';

describe('findMatches', () => {
  it('is case-insensitive, literal, non-overlapping and in order', () => {
    expect(findMatches('Foo foo FOO', 'foo')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    // Regex syntax in the query is text, not a pattern.
    expect(findMatches('a.b axb (x)', '.')).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches('f(x) + g(x)', '(x)')).toHaveLength(2);
    expect(findMatches('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('returns nothing for an empty query and stops at the cap', () => {
    expect(findMatches('abc', '')).toEqual([]);
    expect(findMatches('e'.repeat(50), 'e', 10)).toHaveLength(10);
  });

  it('keeps offsets right after a character whose lowercase is longer', () => {
    // 'İ'.toLowerCase() is two code units; lowercasing the text first would
    // shift every later offset by one.
    const text = 'İstanbul target';
    const [m] = findMatches(text, 'target');
    expect(text.slice(m.start, m.end)).toBe('target');
  });
});

/** Build a DOM that splits `parts` across nested spans, like highlight.js. */
function mount(parts: string[]): HTMLElement {
  const root = document.createElement('div');
  const pre = document.createElement('pre');
  root.appendChild(pre);
  parts.forEach((p, i) => {
    if (i % 2) {
      const span = document.createElement('span');
      span.textContent = p;
      pre.appendChild(span);
    } else {
      pre.appendChild(document.createTextNode(p));
    }
  });
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('textSegments + rangesFor', () => {
  it('finds a match that spans highlight.js token boundaries', () => {
    const root = mount(['const ', 'x', ' = ', '1', ';']);
    const seg = textSegments(root);
    expect(seg.text).toBe('const x = 1;');
    const [r] = rangesFor(seg, findMatches(seg.text, 'x = 1'));
    expect(r.toString()).toBe('x = 1');
  });

  it('ignores a textarea’s text child — React leaves the stale initial value there', () => {
    const root = mount(['alpha']);
    const ta = document.createElement('textarea');
    ta.textContent = 'alpha';
    root.appendChild(ta);
    expect(textSegments(root).text).toBe('alpha');
  });

  it('property: every range covers exactly the text it matched, however the text is split', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: fc.constantFrom('a', 'b', 'A', ' ', '\n', 'x') , maxLength: 6 }), { minLength: 1, maxLength: 12 }),
        fc.string({ unit: fc.constantFrom('a', 'b', 'A', ' ', 'x'), minLength: 1, maxLength: 3 }),
        (parts, query) => {
          document.body.innerHTML = '';
          const root = mount(parts);
          const seg = textSegments(root);
          expect(seg.text).toBe(parts.join(''));
          const ms = findMatches(seg.text, query);
          const rs = rangesFor(seg, ms);
          expect(rs).toHaveLength(ms.length);
          rs.forEach((r, i) => {
            expect(r.toString()).toBe(seg.text.slice(ms[i].start, ms[i].end));
            expect(r.toString().toLowerCase()).toBe(query.toLowerCase());
          });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('highlight registry', () => {
  it('is the union of panes — clearing one does not wipe its neighbour', () => {
    const registry = new Map<string, { ranges: Range[] }>();
    const g = globalThis as unknown as Record<string, unknown>;
    const prevCSS = g.CSS;
    const prevHighlight = g.Highlight;
    g.CSS = { highlights: registry };
    g.Highlight = class {
      ranges: Range[];
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    };
    try {
      const a = Symbol('a');
      const b = Symbol('b');
      const ra = document.createRange();
      const rb = document.createRange();
      setPaneHighlights(a, [ra], ra);
      setPaneHighlights(b, [rb], null);
      expect(registry.get(FIND_HIGHLIGHT)!.ranges).toEqual([ra, rb]);
      expect(registry.get(FIND_HIGHLIGHT_CURRENT)!.ranges).toEqual([ra]);

      clearPaneHighlights(a);
      expect(registry.get(FIND_HIGHLIGHT)!.ranges).toEqual([rb]);
      expect(registry.has(FIND_HIGHLIGHT_CURRENT)).toBe(false);

      clearPaneHighlights(b);
      expect(registry.size).toBe(0);
    } finally {
      g.CSS = prevCSS;
      g.Highlight = prevHighlight;
    }
  });
});
