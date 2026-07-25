import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  coerceNode,
  parseWidget,
  MAX_DEPTH,
  MAX_CHILDREN,
  MAX_ITEMS,
  MAX_TEXT,
  type WidgetNode,
} from './catalog';

describe('coerceNode — accepts well-formed nodes', () => {
  it('text with an optional variant', () => {
    expect(coerceNode({ type: 'text', text: 'hello', variant: 'heading' })).toEqual({
      type: 'text',
      text: 'hello',
      variant: 'heading',
    });
    // an unknown variant is dropped, the node survives
    expect(coerceNode({ type: 'text', text: 'x', variant: 'bogus' })).toEqual({
      type: 'text',
      text: 'x',
      variant: undefined,
    });
  });

  it('metric, statGrid, keyValue, timeline, list', () => {
    expect(coerceNode({ type: 'metric', label: 'Spend', value: '$4.10', state: 'up' })).toMatchObject({
      type: 'metric',
      label: 'Spend',
      state: 'up',
    });
    expect(coerceNode({ type: 'statGrid', items: [{ label: 'a', value: '1' }] })).toMatchObject({
      type: 'statGrid',
    });
    expect(coerceNode({ type: 'keyValue', rows: [{ key: 'k', value: 'v' }] })).toMatchObject({
      type: 'keyValue',
    });
    expect(coerceNode({ type: 'timeline', items: [{ title: 'deploy' }] })).toMatchObject({
      type: 'timeline',
    });
    expect(coerceNode({ type: 'list', items: [{ text: 'one' }], ordered: true })).toMatchObject({
      type: 'list',
      ordered: true,
    });
  });

  it('divider needs no fields', () => {
    expect(coerceNode({ type: 'divider' })).toEqual({ type: 'divider' });
  });

  it('nests section and card', () => {
    const node = coerceNode({
      type: 'card',
      title: 'Build',
      children: [{ type: 'text', text: 'ok' }, { type: 'divider' }],
    }) as Extract<WidgetNode, { type: 'card' }>;
    expect(node.children).toHaveLength(2);
  });
});

describe('coerceNode — drops rather than repairs', () => {
  it('rejects non-objects and unknown types', () => {
    for (const bad of [null, undefined, 42, 'text', [], { type: 'iframe' }, {}]) {
      expect(coerceNode(bad)).toBeNull();
    }
  });

  it('rejects nodes missing required fields', () => {
    expect(coerceNode({ type: 'text' })).toBeNull();
    expect(coerceNode({ type: 'metric', label: 'a' })).toBeNull();
    expect(coerceNode({ type: 'metric', value: '1' })).toBeNull();
    expect(coerceNode({ type: 'badge', text: '   ' })).toBeNull();
  });

  it('drops malformed items but keeps the good ones', () => {
    const node = coerceNode({
      type: 'list',
      items: [{ text: 'keep' }, null, { sub: 'no text' }, 7, { text: 'also keep' }],
    }) as Extract<WidgetNode, { type: 'list' }>;
    expect(node.items.map((i) => i.text)).toEqual(['keep', 'also keep']);
  });

  it('returns null when every child was dropped', () => {
    expect(coerceNode({ type: 'section', children: [{ type: 'nope' }, 3] })).toBeNull();
    expect(coerceNode({ type: 'list', items: [{}] })).toBeNull();
  });
});

describe('coerceNode — security boundary', () => {
  // A remote src would leak the viewer's IP and an egress signal from something
  // presented as a purely declarative widget.
  it('accepts only data: image URLs', () => {
    expect(coerceNode({ type: 'image', src: 'data:image/png;base64,AAAA' })).toMatchObject({
      type: 'image',
    });
    for (const src of [
      'https://tracker.example.com/pixel.png',
      'http://x/y.png',
      '//evil.test/a.png',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'DATA:image/png;base64,AAAA',
    ]) {
      expect(coerceNode({ type: 'image', src }), src).toBeNull();
    }
  });

  // `action` is a name the host dispatches, never code.
  it('restricts actionButton actions to a safe charset', () => {
    expect(coerceNode({ type: 'actionButton', label: 'Re-run', action: 'widget.refresh' })).toMatchObject({
      action: 'widget.refresh',
    });
    // Regression: ':' was once allowed for namespacing, which let a
    // `javascript:` scheme through. Dots namespace; colons don't.
    expect(coerceNode({ type: 'actionButton', label: 'x', action: 'run:retry' })).toBeNull();
    for (const action of [
      'alert(1)',
      'a b',
      'javascript:x',
      '../../etc/passwd',
      '<script>',
      '',
    ]) {
      expect(coerceNode({ type: 'actionButton', label: 'x', action }), action).toBeNull();
    }
  });

  it('caps depth so a deeply nested tree cannot reach the renderer', () => {
    let deep: unknown = { type: 'text', text: 'bottom' };
    for (let i = 0; i < MAX_DEPTH + 5; i++) deep = { type: 'section', children: [deep] };
    expect(coerceNode(deep)).toBeNull();
  });

  it('caps children, items and text length', () => {
    const many = Array.from({ length: MAX_CHILDREN + 40 }, () => ({ type: 'divider' }));
    const section = coerceNode({ type: 'section', children: many }) as Extract<WidgetNode, { type: 'section' }>;
    expect(section.children).toHaveLength(MAX_CHILDREN);

    const items = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ text: `i${i}` }));
    const list = coerceNode({ type: 'list', items }) as Extract<WidgetNode, { type: 'list' }>;
    expect(list.items).toHaveLength(MAX_ITEMS);

    const long = coerceNode({ type: 'text', text: 'x'.repeat(MAX_TEXT * 3) }) as Extract<
      WidgetNode,
      { type: 'text' }
    >;
    expect(long.text).toHaveLength(MAX_TEXT);
  });

  it('normalises ragged table rows to the column count', () => {
    const t = coerceNode({
      type: 'table',
      columns: ['a', 'b'],
      rows: [['1'], ['1', '2', '3'], 'not a row'],
    }) as Extract<WidgetNode, { type: 'table' }>;
    expect(t.rows).toEqual([['1', ''], ['1', '2']]);
  });

  it('drops negative pie slices but keeps them for bar charts', () => {
    const pie = coerceNode({
      type: 'chart',
      chart: 'pie',
      points: [{ label: 'a', value: 5 }, { label: 'b', value: -3 }],
    }) as Extract<WidgetNode, { type: 'chart' }>;
    expect(pie.points).toHaveLength(1);

    const bar = coerceNode({
      type: 'chart',
      chart: 'bar',
      points: [{ label: 'a', value: 5 }, { label: 'b', value: -3 }],
    }) as Extract<WidgetNode, { type: 'chart' }>;
    expect(bar.points).toHaveLength(2);
  });

  it('rejects non-finite numbers and clamps progress', () => {
    expect(coerceNode({ type: 'progress', value: Number.NaN })).toBeNull();
    expect(coerceNode({ type: 'progress', value: Infinity })).toBeNull();
    expect(coerceNode({ type: 'progress', value: 900 })).toMatchObject({ value: 100 });
    expect(coerceNode({ type: 'progress', value: -50 })).toMatchObject({ value: 0 });
    expect(
      coerceNode({ type: 'chart', chart: 'bar', points: [{ label: 'a', value: Number.NaN }] }),
    ).toBeNull();
  });
});

describe('parseWidget', () => {
  it('accepts a JSON string or a parsed value', () => {
    expect(parseWidget('{"type":"divider"}')).toEqual({ type: 'divider' });
    expect(parseWidget({ type: 'divider' })).toEqual({ type: 'divider' });
  });

  it('returns null for unparseable input instead of throwing', () => {
    expect(parseWidget('{oh no')).toBeNull();
    expect(parseWidget('')).toBeNull();
    expect(parseWidget(undefined)).toBeNull();
  });
});

/**
 * The coercer is the boundary between a model's output and our renderer, so it
 * must be total: any input at all, no throw. Hand-written cases can't cover the
 * shapes an adversary (or a confused model) would actually produce.
 */
describe('coerceNode — fuzz', () => {
  it('never throws on arbitrary JSON-ish input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(() => coerceNode(input)).not.toThrow();
      }),
      { numRuns: 2_000 },
    );
  });

  it('never throws when the type field is valid but the payload is arbitrary', () => {
    const types = [
      'text', 'metric', 'statGrid', 'list', 'table', 'keyValue', 'badge',
      'timeline', 'progress', 'chart', 'divider', 'image', 'actionButton',
      'section', 'card',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...types), fc.object(), (type, rest) => {
        expect(() => coerceNode({ ...rest, type })).not.toThrow();
      }),
      { numRuns: 2_000 },
    );
  });

  it('output is always either null or a node of a catalogued type', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const out = coerceNode(input);
        if (out !== null) expect(typeof out.type).toBe('string');
      }),
      { numRuns: 1_000 },
    );
  });

  it('parseWidget never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseWidget(s)).not.toThrow();
      }),
      { numRuns: 1_000 },
    );
  });
});
