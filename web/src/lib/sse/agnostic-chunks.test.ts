// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  handleAgnosticChunk,
  isAgnosticChunk,
  type AgnosticChunkType,
} from './agnostic-chunks';
import { useAssistantStore } from '@/stores/assistant-store';
import { useWidgetStore } from '@/stores/widget-store';

/**
 * Replaces `widget-create-wiring.test.ts`, which asserted that every surface
 * handled `widget_create` — surfaces × chunk-types assertions, all of them
 * source-greps, and it could not see the two other chunk types with the same
 * hole. The invariant is inverted here: NO surface may handle these itself,
 * because one shared module does. One assertion, and it covers types added later.
 */

const AGNOSTIC: AgnosticChunkType[] = [
  'cron_create',
  'standing_order_create',
  'widget_create',
  'memory_extract',
];

beforeEach(() => {
  useAssistantStore.setState({ orders: [], cards: [] } as never);
  useWidgetStore.setState({ widgets: [] } as never);
});

describe('the registry is the only handler', () => {
  const SRC = path.resolve(__dirname, '../..');
  /** Files that read the SSE chunk stream directly, and so must offer every event to the registry. */
  const DIRECT = [
    // The one turn path Chat, Cowork, Code and Browser share.
    'hooks/use-surface-turn.tsx',
    'components/surfaces/assistant/assistant-surface.tsx',
  ];
  /**
   * Surfaces that see chunks only through the shared turn's `chunks` hooks —
   * which it calls AFTER offering the event to the registry, so an agnostic
   * event never reaches them.
   */
  const VIA_SHARED_TURN = [
    'components/surfaces/chat/chat-surface.tsx',
    'components/surfaces/cowork/cowork-surface.tsx',
    'components/surfaces/code/code-surface.tsx',
    // Joined when it stopped hand-rolling its own loop against the raw
    // Messages API and started routing goals through the main chat path (DR-22).
    'components/surfaces/browser/browser-surface.tsx',
  ];
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  /** A local case means the event is handled twice, or differently here than everywhere else. */
  const handlesLocally = (src: string, t: string) =>
    new RegExp(`case\\s+["']${t}["']|event\\.type\\s*===\\s*["']${t}["']`).test(src);

  it.each(DIRECT)('%s delegates rather than handling them itself', (rel) => {
    const src = read(rel);
    expect(src, `${rel} does not call the shared handler`).toContain('handleAgnosticChunk(');
    for (const t of AGNOSTIC) {
      expect(handlesLocally(src, t), `${rel} still handles '${t}' itself`).toBe(false);
    }
  });

  it.each(VIA_SHARED_TURN)('%s receives chunks only through the shared turn', (rel) => {
    const src = read(rel);
    expect(src).toContain('useSurfaceTurn(');
    expect(src, `${rel} reads the stream itself`).not.toMatch(/\bonChunk\s*\(/);
    for (const t of AGNOSTIC) {
      expect(handlesLocally(src, t), `${rel} still handles '${t}' itself`).toBe(false);
    }
  });

  it('the shared turn offers every event to the registry before the surface sees it', () => {
    const src = read('hooks/use-surface-turn.tsx');
    const onChunk = src.slice(src.indexOf('onChunk(event, cid)'));
    const registry = onChunk.indexOf('handleAgnosticChunk(');
    expect(registry).toBeGreaterThan(-1);
    expect(registry).toBeLessThan(onChunk.indexOf('chunks?.before'));
    expect(registry).toBeLessThan(onChunk.indexOf('chunks?.after'));
  });

  it('covers every streaming consumer in the tree', () => {
    // Guards the lists above from going stale when a surface is added.
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) {
          const src = fs.readFileSync(p, 'utf8');
          // Two dispatch shapes exist: an `onChunk` handler and an if/else
          // chain on `event.type`. A detector that only knew the first missed
          // the surface that had the ONLY standing_order_create handler.
          if (/\bonChunk\s*\(/.test(src) || /event\.type\s*===/.test(src)) {
            found.push(path.relative(SRC, p));
          }
        }
      }
    };
    walk(path.join(SRC, 'components'));
    walk(path.join(SRC, 'hooks'));
    for (const rel of DIRECT) expect(found, `${rel} no longer reads the stream`).toContain(rel);
    for (const rel of found) {
      expect([...DIRECT, ...VIA_SHARED_TURN], `${rel} reads the stream but is not listed`).toContain(rel);
    }
  });
});

describe('handleAgnosticChunk', () => {
  it('claims exactly the agnostic types', () => {
    for (const t of AGNOSTIC) expect(isAgnosticChunk(t)).toBe(true);
    for (const t of ['text', 'tool_use', 'done', 'canvas', 'input_request']) {
      expect(isAgnosticChunk(t)).toBe(false);
    }
  });

  it('leaves a surface-specific chunk for the surface', () => {
    expect(handleAgnosticChunk({ type: 'text', content: 'hi' }, { chatId: 'c1', surface: 'T' }))
      .toBe(false);
  });

  it('turns a cron_create into a standing order', () => {
    const ok = handleAgnosticChunk(
      { type: 'cron_create', input: { expression: '0 9 * * *', prompt: 'stand-up' } },
      { chatId: 'c1', surface: 'T' },
    );
    expect(ok).toBe(true);
    const orders = useAssistantStore.getState().orders;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      instruction: 'stand-up',
      trigger: { type: 'cron', expression: '0 9 * * *' },
      notifyVia: 'toast',
    });
  });

  it('accepts the alternative input keys the model actually uses', () => {
    handleAgnosticChunk(
      { type: 'cron_create', input: { cron: '0 8 * * *', task: 'water the plants' } },
      { chatId: 'c1', surface: 'T' },
    );
    expect(useAssistantStore.getState().orders[0]).toMatchObject({
      instruction: 'water the plants',
      trigger: { expression: '0 8 * * *' },
    });
  });

  it('honours the surface notifyVia — the one legitimate difference', () => {
    handleAgnosticChunk(
      { type: 'cron_create', input: { expression: '0 9 * * *', prompt: 'x' } },
      { chatId: 'c1', surface: 'Assistant', notifyVia: 'assistant' },
    );
    expect(useAssistantStore.getState().orders[0].notifyVia).toBe('assistant');
  });

  it('converts expiresInHours into the absolute expiry the store keeps', () => {
    const before = Date.now();
    handleAgnosticChunk(
      {
        type: 'standing_order_create',
        input: { instruction: 'watch the build', trigger_type: 'cron', expression: '*/5 * * * *', expiresInHours: 2 },
      },
      { chatId: 'c1', surface: 'T' },
    );
    const order = useAssistantStore.getState().orders[0];
    expect(order.instruction).toBe('watch the build');
    expect(order.expiresAt!).toBeGreaterThanOrEqual(before + 2 * 3600000);
  });

  it('stores a widget', () => {
    const ok = handleAgnosticChunk(
      { type: 'widget_create', input: { title: 'Burn-up', recipe: 'count issues' } },
      { chatId: 'c1', surface: 'T' },
    );
    expect(ok).toBe(true);
    expect(useWidgetStore.getState().widgets).toHaveLength(1);
  });

  it('claims a malformed payload without letting it break the stream', () => {
    // Returning false would send it to the surface's switch, which has no case
    // for it — so it must be claimed AND survived.
    for (const bad of [
      { type: 'cron_create' },
      { type: 'cron_create', input: null },
      { type: 'standing_order_create', input: {} },
      { type: 'widget_create', input: 'nonsense' },
      { type: 'memory_extract' },
    ]) {
      expect(handleAgnosticChunk(bad as never, { chatId: 'c1', surface: 'T' }), JSON.stringify(bad))
        .toBe(true);
    }
    expect(useAssistantStore.getState().orders).toHaveLength(0);
  });

  it('survives a handler that throws', () => {
    const spy = vi.spyOn(useAssistantStore.getState(), 'addOrder').mockImplementation(() => {
      throw new Error('store exploded');
    });
    expect(() =>
      handleAgnosticChunk(
        { type: 'cron_create', input: { expression: '0 9 * * *', prompt: 'x' } },
        { chatId: 'c1', surface: 'T' },
      ),
    ).not.toThrow();
    spy.mockRestore();
  });
});
