// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { handleCoreChunk, isCoreChunk, type ConversationStreamStore } from './core-chunks';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useCodeStore } from '@/stores/code-store';

/**
 * The stream handling that was written three times.
 *
 * chat-store, cowork-store and code-store each independently grew the same
 * actions with the same signatures — the contract existed without a name, so
 * everything consuming it was duplicated. These tests hold the contract in place
 * and pin the behaviour that used to live in three switches.
 */

function fakeStore() {
  return {
    addMessage: vi.fn(),
    appendToLastAssistant: vi.fn(),
    addToolCall: vi.fn(),
    updateToolResult: vi.fn(),
    completeRunningTools: vi.fn(),
  } satisfies ConversationStreamStore;
}
/** The two REQUIRED relay deps default to spies; a test can override either. */
const ctx = (store: ReturnType<typeof fakeStore>, extra: Record<string, unknown> = {}) => ({
  chatId: 'c1',
  store,
  printDocument: vi.fn(),
  onCanvas: vi.fn(),
  ...extra,
});

describe('all three stores satisfy the contract', () => {
  /**
   * The compile-time half is the `satisfies` below; this is the runtime half,
   * because a store could rename an action and the surfaces would still pass it
   * structurally through an `any` somewhere.
   */
  it.each([
    ['chat', useChatStore],
    ['cowork', useCoworkStore],
    ['code', useCodeStore],
  ])('%s-store', (_name, store) => {
    const s = store.getState() as unknown as Record<string, unknown>;
    for (const action of [
      'addMessage',
      'appendToLastAssistant',
      'addToolCall',
      'updateToolResult',
      'completeRunningTools',
    ]) {
      expect(typeof s[action], action).toBe('function');
    }
    // Structural: it is usable AS the contract, not merely similar to it.
    const asContract: ConversationStreamStore = store.getState();
    expect(asContract).toBeTruthy();
  });
});

describe('handleCoreChunk', () => {
  it('claims exactly the core types', () => {
    for (const t of [
      'turn_start', 'text', 'thinking', 'tool_use', 'tool_result', 'error',
      'input_request', 'connector_request', 'document_print', 'canvas',
    ]) {
      expect(isCoreChunk(t)).toBe(true);
    }
    for (const t of ['done', 'widget_create', 'system_init', 'browser_tool_use']) {
      expect(isCoreChunk(t)).toBe(false);
    }
  });

  it('leaves a non-core chunk to the surface', () => {
    const s = fakeStore();
    expect(handleCoreChunk({ type: 'browser_tool_use' }, ctx(s))).toBe(false);
  });

  /**
   * The Agent SDK does not always emit tool_result, so text arriving after a tool
   * is the signal that the tool finished. All three surfaces had this, each with
   * its own comment explaining it.
   */
  it('completes running tools on turn_start AND on text', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'turn_start' }, ctx(s));
    expect(s.completeRunningTools).toHaveBeenCalledWith('c1');

    const s2 = fakeStore();
    handleCoreChunk({ type: 'text', content: 'hi' }, ctx(s2));
    expect(s2.completeRunningTools).toHaveBeenCalledWith('c1');
    expect(s2.appendToLastAssistant).toHaveBeenCalledWith('c1', 'hi');
  });

  it('routes thinking to the thinking slot, not the content slot', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'thinking', content: 'pondering' }, ctx(s));
    expect(s.appendToLastAssistant).toHaveBeenCalledWith('c1', '', 'pondering');
  });

  it('records a tool call and reports it to the surface', () => {
    const s = fakeStore();
    const onToolStarted = vi.fn();
    handleCoreChunk(
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/a.ts' } },
      ctx(s, { onToolStarted }),
    );
    expect(s.completeRunningTools).toHaveBeenCalled();
    expect(s.addToolCall).toHaveBeenCalledWith('c1', expect.objectContaining({
      id: 't1', name: 'Write', input: { file_path: '/a.ts' }, status: 'running',
    }));
    expect(onToolStarted).toHaveBeenCalledWith('t1', 'Write', { file_path: '/a.ts' });
  });

  it('lets a surface normalise the input before it is recorded', () => {
    // Cowork resolves a relative file_path against the cwd so Open works.
    const s = fakeStore();
    handleCoreChunk(
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'rel.ts' } },
      ctx(s, {
        normaliseToolInput: (_n: string, i: Record<string, unknown>) => ({ ...i, file_path: `/cwd/${i.file_path}` }),
      }),
    );
    expect(s.addToolCall).toHaveBeenCalledWith('c1', expect.objectContaining({
      input: { file_path: '/cwd/rel.ts' },
    }));
  });

  it('falls back to a synthetic tool id and name rather than dropping the call', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'tool_use' }, ctx(s));
    const arg = s.addToolCall.mock.calls[0][1];
    expect(arg.id).toMatch(/^tool_/);
    expect(arg.name).toBe('Unknown');
    expect(arg.input).toEqual({});
  });

  it('stringifies a non-string tool result', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'tool_result', tool_use_id: 't1', result: { ok: 1 } }, ctx(s));
    expect(s.updateToolResult).toHaveBeenCalledWith('c1', 't1', '{"ok":1}', undefined);
  });

  it('accepts either id field on a tool result', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'tool_result', id: 't2', result: 'out', is_error: true }, ctx(s));
    expect(s.updateToolResult).toHaveBeenCalledWith('c1', 't2', 'out', true);
  });

  it('appends an error into the transcript with a default message', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'error' }, ctx(s));
    expect(s.appendToLastAssistant).toHaveBeenCalledWith('c1', '\n\n**Error:** An error occurred');
  });

  it('declines a chunk the surface has opted out of', () => {
    const s = fakeStore();
    expect(handleCoreChunk({ type: 'tool_use' }, ctx(s, { skip: ['tool_use'] }))).toBe(false);
    expect(s.addToolCall).not.toHaveBeenCalled();
    // ...while still taking the ones it did not skip.
    expect(handleCoreChunk({ type: 'text', content: 'x' }, ctx(s, { skip: ['tool_use'] }))).toBe(true);
  });
});

/**
 * What each surface still owns, recorded so shrinking the list is deliberate and
 * growing it is a conversation. Chat is fully migrated; cowork and code keep
 * tool_use/tool_result because theirs carry real surface work (a stuck-tool
 * watchdog, artifact categorisation, a QUARRY_CRON sniffer) that a one-line
 * callback would misrepresent.
 */
describe('migration status is explicit, not accidental', () => {
  const SRC = path.resolve(__dirname, '../..');
  const EXPECTED: Record<string, string[]> = {
    'components/surfaces/chat/chat-surface.tsx': [],
    'components/surfaces/cowork/cowork-surface.tsx': ['tool_use', 'tool_result'],
    'components/surfaces/code/code-surface.tsx': ['tool_use', 'tool_result'],
    // Fully delegated: its switch is gone entirely.
    'components/projects/project-detail.tsx': [],
  };

  it.each(Object.entries(EXPECTED))('%s skips exactly %j', (rel, expected) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src, `${rel} does not call handleCoreChunk`).toContain('handleCoreChunk(');
    const m = /skip:\s*\[([^\]]*)\]/.exec(src);
    const actual = m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : [];
    expect(actual.sort()).toEqual([...expected].sort());
  });

  it('no surface still handles a chunk it has delegated', () => {
    for (const [rel, skipped] of Object.entries(EXPECTED)) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      for (const t of [
        'turn_start', 'text', 'thinking', 'error',
        'input_request', 'connector_request', 'document_print', 'canvas',
      ]) {
        if (skipped.includes(t)) continue;
        expect(src, `${rel} still cases on delegated '${t}'`).not.toMatch(
          new RegExp(`case\\s+["']${t}["']`),
        );
      }
    }
  });
});

/**
 * The three RELAY chunks. Each pauses the turn server-side until the client
 * answers, so a surface that does not handle one HANGS rather than losing a
 * feature — a connector request for 300s, a document print for 60s. Code handled
 * none of the three, which is why the deps are required rather than optional:
 * forgetting one is now a compile error.
 */
describe('relay chunks — the ones that hang when unhandled', () => {
  it('files an input_request as a question message, and notifies', () => {
    const s = fakeStore();
    const notify = vi.fn();
    expect(handleCoreChunk(
      { type: 'input_request', toolUseId: 'q1', questions: [{ question: 'ok?' }] },
      ctx(s, { notify }),
    )).toBe(true);
    expect(s.addMessage).toHaveBeenCalledWith('c1', expect.objectContaining({
      id: 'q1', questionToolUseId: 'q1', questionData: [{ question: 'ok?' }],
    }));
    expect(notify).toHaveBeenCalled();
  });

  it('files a connector_request with the connector it needs', () => {
    const s = fakeStore();
    expect(handleCoreChunk(
      { type: 'connector_request', toolUseId: 'c9', connectorId: 'github', reason: 'read issues' },
      ctx(s),
    )).toBe(true);
    expect(s.addMessage).toHaveBeenCalledWith('c1', expect.objectContaining({
      connectorRequest: { connectorId: 'github', reason: 'read issues', toolUseId: 'c9' },
    }));
  });

  it('relays a document print by PATH, never the markup', () => {
    const s = fakeStore();
    const printDocument = vi.fn();
    handleCoreChunk(
      { type: 'document_print', toolUseId: 'd1', htmlPath: '/tmp/a.html', outputPath: '/tmp/a.pdf' },
      ctx(s, { printDocument }),
    );
    expect(printDocument).toHaveBeenCalledWith({
      toolUseId: 'd1', htmlPath: '/tmp/a.html', outputPath: '/tmp/a.pdf', printOptions: undefined,
    });
  });

  it('hands a canvas to the surface renderer', () => {
    const s = fakeStore();
    const onCanvas = vi.fn();
    handleCoreChunk({ type: 'canvas', doc: { components: [] } }, ctx(s, { onCanvas }));
    expect(onCanvas).toHaveBeenCalledWith(expect.objectContaining({ doc: { components: [] } }));
  });

  it('still files the message when there is no notifier', () => {
    // notify is optional; the blocking part must not depend on it.
    const s = fakeStore();
    expect(handleCoreChunk({ type: 'input_request', toolUseId: 'q' }, ctx(s))).toBe(true);
    expect(s.addMessage).toHaveBeenCalled();
  });
});

describe('the stuck-tool watchdog', () => {
  /**
   * Existed on cowork ONLY, written after a large PDF read hung there. Chat and
   * code have the identical failure mode and had no watchdog at all — code runs
   * the longest tools of any surface.
   */
  it('is armed for every tool call when the surface provides it', () => {
    const s = fakeStore();
    const watchTool = vi.fn();
    handleCoreChunk({ type: 'tool_use', id: 't1', name: 'Read' }, ctx(s, { watchTool }));
    expect(watchTool).toHaveBeenCalledWith('t1', 'Read');
  });

  it('is armed BEFORE the surface extras, so it does not depend on them', () => {
    const order: string[] = [];
    const s = fakeStore();
    handleCoreChunk({ type: 'tool_use', id: 't1', name: 'Read' }, ctx(s, {
      watchTool: () => order.push('watch'),
      onToolStarted: () => order.push('extras'),
    }));
    expect(order).toEqual(['watch', 'extras']);
  });

  it('every conversation surface arms it', () => {
    const SRC = path.resolve(__dirname, '../..');
    for (const rel of [
      'components/surfaces/chat/chat-surface.tsx',
      'components/surfaces/cowork/cowork-surface.tsx',
      'components/surfaces/code/code-surface.tsx',
    ]) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect(src, `${rel} does not arm the stuck-tool watchdog`).toMatch(/watchTool:/);
      expect(src, `${rel} does not import it`).toContain('watchStuckTool');
    }
  });
});

/** The relay deps are required, so "forgot one" cannot reach runtime. */
describe('no surface can forget a relay handler', () => {
  const SRC = path.resolve(__dirname, '../..');
  it.each([
    'components/surfaces/chat/chat-surface.tsx',
    'components/surfaces/cowork/cowork-surface.tsx',
    'components/surfaces/code/code-surface.tsx',
    'components/projects/project-detail.tsx',
  ])('%s supplies the required relay deps', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src).toMatch(/printDocument,?/);
    expect(src).toMatch(/onCanvas:/);
  });

  /**
   * A surface with no card UI must declare `canRelayToClient: false` rather than
   * leave it defaulting to true — otherwise the provider is handed
   * onInputRequest/onConnectorRequest and parks the turn for 300s waiting for an
   * answer that surface cannot possibly collect.
   */
  it('the assistant surface opts OUT of relay rather than hanging', () => {
    const src = fs.readFileSync(
      path.join(SRC, 'components/surfaces/assistant/assistant-surface.tsx'),
      'utf8',
    );
    expect(src).toMatch(/canRelayToClient:\s*false/);
  });
});
