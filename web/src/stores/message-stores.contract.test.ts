import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { useChatStore } from './chat-store';
import { useCoworkStore } from './cowork-store';
import { useCodeStore } from './code-store';
import { useBrowserStore } from './browser-store';

/**
 * EVERY MESSAGE STORE, NOT ONE OF THEM.
 *
 * "Encountered two children with the same key, goal:r1:question:…" was fixed
 * three times — a write-time guard, then an atomic one, then a rehydrate
 * migration — and the error count never moved. All three went into
 * `chat-store`. The duplicates were in `cowork-store`.
 *
 * Cowork, Code and Browser each own a `messages` map and an `addMessage`, and
 * the goal transcript posts through whichever store owns the surface it is on.
 * A guard on one store is a guard on a quarter of the problem, and nothing said
 * so: the tests exercised chat-store directly and passed.
 *
 * So this is derived from the filesystem. Any store that owns messages —
 * through the shared transcript slice or its own `addMessage` — must refuse a
 * duplicate id and must dedupe on rehydrate. A fifth store added later is
 * covered without anyone remembering this file.
 */

const STORE_DIR = path.resolve(process.cwd(), 'src/stores');
const SLICE_SRC = fs.readFileSync(path.join(STORE_DIR, 'slices/transcript-slice.ts'), 'utf8');
const OWN_ADD = /addMessage:\s*\(chatId,\s*message\)/;
const USES_SLICE = /\.\.\.createTranscriptSlice\(set\b/;
const messageStores = () =>
  fs
    .readdirSync(STORE_DIR)
    .filter((f) => f.endsWith('-store.ts'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(STORE_DIR, f), 'utf8') }))
    .filter((s) => OWN_ADD.test(s.src) || USES_SLICE.test(s.src));

describe('every store that owns messages', () => {
  it('there are several, so a fix in one is not a fix', () => {
    // If this ever drops to one the rest of the file is asserting nothing.
    expect(messageStores().map((s) => s.name).sort()).toEqual([
      'browser-store.ts',
      'chat-store.ts',
      'code-store.ts',
      'cowork-store.ts',
    ]);
  });

  it('refuses a duplicate id inside set', () => {
    const GUARD = /existing\.some\(\(m\) => m\.id === message\.id\)\) return state/;
    // The slice is where the guard lives now; a store that writes its own
    // addMessage again must carry it too.
    expect(SLICE_SRC).toMatch(GUARD);
    const offenders = messageStores()
      .filter((s) => OWN_ADD.test(s.src) && !GUARD.test(s.src))
      .map((s) => s.name);
    expect(offenders, 'addMessage appends unconditionally here').toEqual([]);
  });

  it('collapses legacy transcript rows on rehydrate', () => {
    // The `goal_<random>` residue has distinct ids, so the id dedupe cannot
    // reach it. Every store that a goal can run on must run this too.
    const offenders = messageStores()
      .filter((s) => !/onRehydrateStorage[\s\S]{0,600}dedupeLegacyTranscriptRows\(/.test(s.src))
      .map((s) => s.name);
    expect(offenders, 'old transcript duplicates would keep painting here').toEqual([]);
  });

  it('dedupes persisted messages on rehydrate', () => {
    const offenders = messageStores()
      .filter((s) => !/onRehydrateStorage[\s\S]{0,600}dedupeMessageIds\(/.test(s.src))
      .map((s) => s.name);
    expect(offenders, 'duplicates already on disk would render forever here').toEqual([]);
  });
});

const msg = (id: string) => ({ id, role: 'assistant' as const, content: 'x', timestamp: 1 });

describe('the guard actually holds in each store', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: {} });
    useCoworkStore.setState({ messages: {} });
    useCodeStore.setState({ messages: {} });
    useBrowserStore.setState({ messages: {} });
  });

  for (const [label, store] of [
    ['chat', useChatStore],
    ['cowork', useCoworkStore],
    ['code', useCodeStore],
    ['browser', useBrowserStore],
  ] as const) {
    it(`${label}: two adds with one id leave one message`, () => {
      const { addMessage } = store.getState();
      addMessage('c1', msg('goal:r1:question:abc'));
      addMessage('c1', msg('goal:r1:question:abc'));
      expect(store.getState().messages['c1']).toHaveLength(1);
    });
  }
});

/**
 * The phase-1 additions reached two stores of four: Code and Browser had no
 * per-chat streaming and no `setTurnError`, so a failed Code turn still wrote
 * "**Error:** …" into content the model reads back as history. The shared
 * slice gives all four the same actions; this asserts they behave, not merely
 * exist.
 */
describe('every store carries the whole transcript contract', () => {
  const STORES = [
    ['chat', useChatStore],
    ['cowork', useCoworkStore],
    ['code', useCodeStore],
    ['browser', useBrowserStore],
  ] as const;

  beforeEach(() => {
    for (const [, store] of STORES) {
      // The four setState signatures differ in their other fields; these three are shared.
      (store as unknown as typeof useCodeStore).setState({ messages: {}, streamingChats: {}, isStreaming: false });
    }
  });

  for (const [label, store] of STORES) {
    it(`${label}: a failed turn is recorded on the reply, not appended to it`, () => {
      const s = store.getState();
      s.addMessage('c1', { id: 'u', role: 'user', content: 'go', timestamp: 1 });
      s.addMessage('c1', { id: 'a', role: 'assistant', content: 'partial', timestamp: 2, isStreaming: true });
      store.getState().setTurnError('c1', { code: 'rate_limit', message: 'slow down' });
      const reply = store.getState().messages['c1'][1];
      expect(reply.content).toBe('partial');
      expect(reply.error).toEqual({ code: 'rate_limit', message: 'slow down' });
      expect(reply.isStreaming).toBe(false);
    });

    it(`${label}: one conversation ending does not end another's turn`, () => {
      const s = store.getState();
      s.startStreaming('a');
      s.startStreaming('b');
      store.getState().stopStreaming('a');
      expect(store.getState().streamingChats).toEqual({ b: true });
      expect(store.getState().isStreaming).toBe(true);
      store.getState().stopStreaming('b');
      expect(store.getState().isStreaming).toBe(false);
    });
  }
});
