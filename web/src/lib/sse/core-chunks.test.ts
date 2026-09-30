// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resetTextBoundary, handleCoreChunk, isCoreChunk, type ConversationStreamStore } from './core-chunks';
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
      // Optional in the contract, but every store has them: a store without
      // them would leave a retracted refusal on screen.
      'markSegment',
      'retractSegments',
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
      'input_request', 'connector_request', 'document_print', 'canvas', 'retry', 'retract',
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

  it('a store without setTurnError keeps the old inline text rather than losing the error', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'error' }, ctx(s));
    expect(s.appendToLastAssistant).toHaveBeenCalledWith('c1', '\n\n**Error:** An error occurred');
  });

  it('records an error on the reply instead of writing it into the reply text', () => {
    const s = { ...fakeStore(), setTurnError: vi.fn() };
    handleCoreChunk({ type: 'error', message: 'Please run /login', code: 'auth' }, ctx(s));
    expect(s.setTurnError).toHaveBeenCalledWith('c1', { code: 'auth', message: 'Please run /login' });
    expect(s.appendToLastAssistant).not.toHaveBeenCalled();
  });

  it('classifies an error the server sent without a code', () => {
    const s = { ...fakeStore(), setTurnError: vi.fn() };
    handleCoreChunk({ type: 'error', message: '429 Too Many Requests' }, ctx(s));
    expect(s.setTurnError).toHaveBeenCalledWith('c1', { code: 'rate_limit', message: '429 Too Many Requests' });
  });

  it('shows a provider retry on the streaming reply', () => {
    const s = { ...fakeStore(), setRetryStatus: vi.fn() };
    expect(handleCoreChunk({ type: 'retry', attempt: 2, delayMs: 4000, code: 'overloaded' }, ctx(s))).toBe(true);
    expect(s.setRetryStatus).toHaveBeenCalledWith('c1', { attempt: 2, delayMs: 4000 });
  });

  it('against the real chat store: the error is on the message, and the content is untouched', () => {
    useChatStore.setState({ messages: {} });
    const st = useChatStore.getState();
    st.addMessage('c1', { id: 'u', role: 'user', content: 'hi', timestamp: 1 });
    st.addMessage('c1', { id: 'a', role: 'assistant', content: 'Partial answer', timestamp: 2, isStreaming: true });
    handleCoreChunk({ type: 'error', message: 'overloaded_error', code: 'overloaded' }, ctx(useChatStore.getState() as never));
    const last = useChatStore.getState().messages.c1.at(-1)!;
    expect(last.content).toBe('Partial answer');
    expect(last.error).toEqual({ code: 'overloaded', message: 'overloaded_error' });
    expect(last.isStreaming).toBe(false);
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
 * Where the shared handling runs, recorded so a surface cannot quietly grow its
 * own switch again. It runs in ONE place — the shared turn every conversation
 * surface uses — with nothing skipped: Cowork's and Code's tool work (artifact
 * rail, cron-marker sniffer, preview detection, the risky-command tag) are the
 * `onToolStarted` / `onToolResult` / `normaliseToolInput` callbacks now, not
 * private copies of `tool_use` and `tool_result`.
 */
describe('migration status is explicit, not accidental', () => {
  const SRC = path.resolve(__dirname, '../..');
  const SHARED_TURN = 'hooks/use-surface-turn.tsx';
  const SURFACES = [
    'components/surfaces/chat/chat-surface.tsx',
    'components/surfaces/cowork/cowork-surface.tsx',
    'components/surfaces/code/code-surface.tsx',
    'components/surfaces/browser/browser-surface.tsx',
  ];
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

  it('the shared turn calls it, and skips nothing', () => {
    const src = read(SHARED_TURN);
    expect(src).toContain('handleCoreChunk(');
    expect(src).not.toMatch(/skip:\s*\[/);
  });

  it.each(SURFACES)('%s goes through the shared turn and skips nothing', (rel) => {
    const src = read(rel);
    expect(src, `${rel} does not use the shared turn`).toContain('useSurfaceTurn(');
    expect(src, `${rel} calls the core handler itself`).not.toContain('handleCoreChunk(');
    expect(src, `${rel} opts out of shared chunks`).not.toMatch(/skip:\s*\[/);
  });

  it('no surface still handles a chunk it has delegated', () => {
    for (const rel of [SHARED_TURN, ...SURFACES, 'components/projects/project-detail.tsx']) {
      const src = read(rel);
      for (const t of [
        'turn_start', 'text', 'thinking', 'tool_use', 'tool_result', 'error',
        'input_request', 'connector_request', 'document_print', 'canvas', 'retry',
      ]) {
        expect(src, `${rel} still handles delegated '${t}'`).not.toMatch(
          new RegExp(`case\\s+["']${t}["']|event\\.type\\s*===\\s*["']${t}["']`),
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

/** The relay deps are required, so "forgot one" cannot reach runtime. */
describe('no surface can forget a relay handler', () => {
  const SRC = path.resolve(__dirname, '../..');
  it('the shared turn supplies the required relay deps', () => {
    const src = fs.readFileSync(path.join(SRC, 'hooks/use-surface-turn.tsx'), 'utf8');
    expect(src).toMatch(/printDocument,/);
    expect(src).toMatch(/onCanvas:/);
    // Required of every surface, as the relay deps are of the handler.
    expect(src).toMatch(/\n\s{2}onCanvas: \(event/);
  });

  it.each([
    'components/surfaces/chat/chat-surface.tsx',
    'components/surfaces/cowork/cowork-surface.tsx',
    'components/surfaces/code/code-surface.tsx',
    'components/surfaces/browser/browser-surface.tsx',
  ])('%s says what happens to a canvas', (rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(src).toMatch(/\bonCanvas[,:]/);
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

/**
 * The run-on sentence, seen three times before it was chased:
 *
 *   "Let me start by reading the deck template and the layouts I'll needNow let
 *    me read the magazine-bold theme to understand its tokens"
 *
 * The provider yields one `text` event per content BLOCK and the client appends
 * each onto the last assistant message. Say something, call a tool, say
 * something else, and the two halves are welded together. It reads like a
 * streaming corruption, which is why it was repeatedly mistaken for one.
 */
describe('text that resumes after a tool call starts a paragraph', () => {
  /*
   * The boundary flag is module-level and keyed by chatId, and every test here
   * uses the same default chat — so without this a tool call in one test would
   * put a blank line at the front of the next test's first message.
   */
  beforeEach(() => {
    resetTextBoundary('c1');
    resetTextBoundary('chat-a');
    resetTextBoundary('chat-b');
  });

  it('separates the halves of the reported message', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'text', content: "…and the layouts I'll need" }, ctx(s));
    handleCoreChunk({ type: 'tool_use', id: 't1', name: 'Read' }, ctx(s));
    handleCoreChunk({ type: 'text', content: 'Now let me read the theme' }, ctx(s));

    const appended = s.appendToLastAssistant.mock.calls.map((c) => c[1]);
    expect(appended[0]).toBe("…and the layouts I'll need");
    expect(appended[1], 'the two halves are still welded together').toBe(
      '\n\nNow let me read the theme',
    );
  });

  /** Ordinary consecutive text must not grow blank lines it never had. */
  it('does not separate text that follows text', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'text', content: 'one' }, ctx(s));
    handleCoreChunk({ type: 'text', content: 'two' }, ctx(s));
    expect(s.appendToLastAssistant.mock.calls[1][1]).toBe('two');
  });

  /**
   * Inserted once per boundary, not before every block after the first tool —
   * otherwise a turn with several tools accumulates blank lines.
   */
  it('separates once per tool boundary', () => {
    const s = fakeStore();
    handleCoreChunk({ type: 'tool_use', id: 't1', name: 'Read' }, ctx(s));
    handleCoreChunk({ type: 'text', content: 'a' }, ctx(s));
    handleCoreChunk({ type: 'text', content: 'b' }, ctx(s));
    const appended = s.appendToLastAssistant.mock.calls.map((c) => c[1]);
    expect(appended[0]).toBe('\n\na');
    expect(appended[1]).toBe('b');
  });

  /** One chat's tool call must not put a blank line in another's reply. */
  it('is tracked per chat', () => {
    const a = fakeStore();
    const b = fakeStore();
    handleCoreChunk({ type: 'tool_use', id: 't1', name: 'Read' }, ctx(a, { chatId: 'chat-a' }));
    handleCoreChunk({ type: 'text', content: 'hello' }, ctx(b, { chatId: 'chat-b' }));
    expect(b.appendToLastAssistant.mock.calls[0][1]).toBe('hello');
  });
});
