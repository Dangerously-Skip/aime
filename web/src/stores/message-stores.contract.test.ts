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
 * So this is derived from the filesystem. Any store that declares an
 * `addMessage` must refuse a duplicate id and must dedupe on rehydrate — a
 * fifth store added later is covered without anyone remembering this file.
 */

const STORE_DIR = path.resolve(process.cwd(), 'src/stores');
const messageStores = () =>
  fs
    .readdirSync(STORE_DIR)
    .filter((f) => f.endsWith('-store.ts'))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(STORE_DIR, f), 'utf8') }))
    .filter((s) => /addMessage:\s*\(chatId,\s*message\)/.test(s.src));

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
    const offenders = messageStores()
      .filter((s) => !/existing\.some\(\(m\) => m\.id === message\.id\)\) return state/.test(s.src))
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
