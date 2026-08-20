import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryStore, localStorageStore, type HarnessStore } from './store';
import { fsStore } from './store-fs';

/*
 * ONE SUITE, EVERY BACKING.
 *
 * The harness is moving from "reads and writes files" to "reads and writes
 * through a store", so the browser can run the same loop in the renderer where
 * `node:fs` does not exist and there is no working directory to key on.
 *
 * The whole value of that depends on the implementations behaving identically.
 * A memory store that treats a missing key as an error while the fs store
 * returns null does not give us one harness with two backings — it gives us two
 * harnesses, and the second one fails in ways the first one's tests cannot see.
 * That is this codebase's most repeated injury: four places picked a model, two
 * systems described panels, a loop detector was rewritten rather than shared.
 *
 * So the contract is written once and run against all three. A new backing is
 * added by appending to the table, not by writing new tests — which is the same
 * derive-from-source discipline as `send-route-coverage` and
 * `panel-coverage`, applied to behaviour rather than to structure.
 */

let tmpDir = '';

/** A minimal localStorage so the browser backing can be exercised in node. */
function installFakeLocalStorage() {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

const BACKINGS: Array<[string, () => HarnessStore]> = [
  ['memory', () => memoryStore()],
  ['fs', () => fsStore(tmpDir)],
  [
    'localStorage',
    () => {
      installFakeLocalStorage();
      return localStorageStore(`run-${Math.trunc(performance.now() * 1000)}`);
    },
  ],
];

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-store-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe.each(BACKINGS)('HarnessStore contract — %s', (_name, make) => {
  it('a key that was never written reads as null, not an error', async () => {
    // The loop asks for `question.json` on every pass and usually there isn't
    // one. Absent has to be an ordinary answer.
    const s = make();
    await expect(s.readText('goal.json')).resolves.toBeNull();
  });

  it('round-trips what was written', async () => {
    const s = make();
    await s.writeText('goal.json', '{"objective":"x"}');
    await expect(s.readText('goal.json')).resolves.toBe('{"objective":"x"}');
  });

  it('write REPLACES rather than appends', async () => {
    const s = make();
    await s.writeText('tasks.json', 'first');
    await s.writeText('tasks.json', 'second');
    await expect(s.readText('tasks.json')).resolves.toBe('second');
  });

  it('append accumulates, and creates when absent', async () => {
    /*
     * The progress log is append-only and is the run's account of itself. A
     * backing that silently replaced would erase the history the user reads to
     * understand what happened.
     */
    const s = make();
    await s.appendText('progress.md', 'one\n');
    await s.appendText('progress.md', 'two\n');
    await expect(s.readText('progress.md')).resolves.toBe('one\ntwo\n');
  });

  it('remove makes it absent, and removing twice is fine', async () => {
    // `consumeAnswer` deletes the question so a session cannot act on it twice;
    // a retry must not throw.
    const s = make();
    await s.writeText('question.json', '{}');
    await s.remove('question.json');
    await expect(s.readText('question.json')).resolves.toBeNull();
    await expect(s.remove('question.json')).resolves.toBeUndefined();
  });

  it('keys lists what is present and nothing else', async () => {
    const s = make();
    await s.writeText('goal.json', 'a');
    await s.writeText('tasks.json', 'b');
    await s.remove('tasks.json');
    const keys = await s.keys();
    expect(keys).toContain('goal.json');
    expect(keys).not.toContain('tasks.json');
  });

  it('preserves content exactly — unicode, newlines, empty string', async () => {
    /*
     * The ledger is JSON and the progress log is markdown with user text in it.
     * A backing that trimmed, normalised newlines, or turned '' into null would
     * corrupt a run in a way that only shows up as a parse failure much later.
     */
    const s = make();
    const payload = '{"t":"line1\nline2 — em dash, emoji 🎯, quote \\" end"}';
    await s.writeText('tasks.json', payload);
    await expect(s.readText('tasks.json')).resolves.toBe(payload);

    await s.writeText('empty.txt', '');
    await expect(s.readText('empty.txt')).resolves.toBe('');
  });

  it('keys() agrees across backings for NESTED keys', async () => {
    /*
     * Found by reading, not by the suite, which is the argument for writing it
     * down. Memory and localStorage key on the whole string, so `a/goal.json`
     * comes back from keys(). The fs backing used a non-recursive readdir and
     * returned nothing for it — the same store answering the same question two
     * ways, which is the precise failure a contract test exists to stop.
     */
    const s = make();
    await s.writeText('nested/goal.json', 'A');
    await expect(s.keys()).resolves.toContain('nested/goal.json');
  });

  it('keys do not collide across separators', async () => {
    // Run directories nest; a backing that flattened would merge two runs.
    const s = make();
    await s.writeText('a/goal.json', 'A');
    await s.writeText('b/goal.json', 'B');
    await expect(s.readText('a/goal.json')).resolves.toBe('A');
    await expect(s.readText('b/goal.json')).resolves.toBe('B');
  });
});

describe('localStorage backing degrades rather than throwing', () => {
  it('keeps working when localStorage is unavailable', async () => {
    /*
     * Private mode, a disabled store, or a full quota. Losing persistence costs
     * a resumable run; throwing costs the run itself, and the whole point of the
     * harness is that a long job survives its own hiccups.
     */
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const s = localStorageStore('no-storage');
    await s.writeText('goal.json', 'still works');
    await expect(s.readText('goal.json')).resolves.toBe('still works');
  });

  it('namespaces runs so one cannot read another', async () => {
    installFakeLocalStorage();
    const a = localStorageStore('run-a');
    const b = localStorageStore('run-b');
    await a.writeText('goal.json', 'A');
    await b.writeText('goal.json', 'B');
    await expect(a.readText('goal.json')).resolves.toBe('A');
    await expect(b.readText('goal.json')).resolves.toBe('B');
  });
});
