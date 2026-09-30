import { describe, it, expect } from 'vitest';
import { openIdbTranscriptBackend } from './idb-backend';

/**
 * The IndexedDB wrapper against a minimal in-test IndexedDB.
 *
 * Neither jsdom nor Node ships IndexedDB and `fake-indexeddb` is not a
 * dependency, so this implements the slice of the API the wrapper touches —
 * open with upgrade, one object store, put/delete/clear/getAll over a key
 * range, transactions that complete after their requests — with IndexedDB's
 * asynchrony, key ordering and structured cloning. It proves the wrapper's
 * wiring (key layout, range bounds, transaction handling, the null paths);
 * the storage logic above it is tested against the same contract in
 * transcript-storage.test.ts.
 */

type Req = { result?: unknown; error?: unknown; onsuccess?: (() => void) | null; onerror?: (() => void) | null };

function fakeIndexedDB(mode: 'ok' | 'fail' | 'hang' = 'ok') {
  const later = (fn: () => void) => setTimeout(fn, 0);
  const databases = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();

  function database(entry: { version: number; stores: Map<string, Map<string, unknown>> }) {
    return {
      objectStoreNames: { contains: (n: string) => entry.stores.has(n) },
      createObjectStore: (n: string) => void entry.stores.set(n, new Map()),
      close: () => {},
      onversionchange: null,
      transaction(name: string) {
        const data = entry.stores.get(name)!;
        const tx: Record<string, unknown> & { oncomplete?: () => void; onerror?: () => void } = { error: null };
        let pending = 0;
        const settle = () => later(() => pending === 0 && tx.oncomplete?.());
        const op = (fn: () => unknown): Req => {
          const req: Req = {};
          pending++;
          later(() => {
            try {
              req.result = fn();
              req.onsuccess?.();
            } catch (e) {
              req.error = tx.error = e;
              req.onerror?.();
              tx.onerror?.();
            }
            pending--;
            settle();
          });
          return req;
        };
        tx.abort = () => {};
        tx.objectStore = () => ({
          put: (value: unknown, key: string) => {
            const copy = structuredClone(value);
            return op(() => data.set(key, copy));
          },
          delete: (key: string) => op(() => data.delete(key)),
          clear: () => op(() => data.clear()),
          getAll: (range: { includes: (k: string) => boolean }) =>
            op(() =>
              [...data.entries()]
                .filter(([k]) => range.includes(k))
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([, v]) => structuredClone(v)),
            ),
        });
        return tx;
      },
    };
  }

  const factory = {
    open(name: string, version: number) {
      const req: Req & { onupgradeneeded?: () => void } = {};
      later(() => {
        if (mode === 'hang') return;
        if (mode === 'fail') {
          req.error = new DOMException('denied', 'UnknownError');
          req.onerror?.();
          return;
        }
        let entry = databases.get(name);
        const upgrade = !entry || entry.version < version;
        if (!entry) databases.set(name, (entry = { version, stores: new Map() }));
        req.result = database(entry);
        if (upgrade) {
          entry.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
  const keyRange = {
    bound: (lower: string, upper: string, lowerOpen: boolean, upperOpen: boolean) => ({
      includes: (k: string) => (lowerOpen ? k > lower : k >= lower) && (upperOpen ? k < upper : k <= upper),
    }),
  };
  return {
    factory: factory as unknown as IDBFactory,
    keyRange: keyRange as unknown as typeof IDBKeyRange,
  };
}

const msg = (id: string) => ({ id, role: 'assistant', content: id });

describe('openIdbTranscriptBackend', () => {
  it('is null without IndexedDB, so the stores stay on localStorage', async () => {
    // Node, like the test environments, has no `indexedDB` global.
    expect(await openIdbTranscriptBackend()).toBeNull();
  });

  it('is null when the open fails', async () => {
    expect(await openIdbTranscriptBackend(fakeIndexedDB('fail'))).toBeNull();
  });

  it('is null when the open never settles, rather than holding the app on a spinner', async () => {
    expect(await openIdbTranscriptBackend({ ...fakeIndexedDB('hang'), timeoutMs: 20 })).toBeNull();
  });

  it('stores one record per conversation, per surface, and survives a reopen', async () => {
    const idb = fakeIndexedDB();
    const b = (await openIdbTranscriptBackend(idb))!;
    expect(b).not.toBeNull();

    await b.putMany('chat', { a: [msg('a1')], b: [msg('b1')] });
    await b.put('chat', 'c', [msg('c1')]);
    // A surface whose name extends another's must not leak into its range.
    await b.put('chatx', 'z', [msg('z1')]);
    await b.put('cowork', 'a', [msg('other')]);

    expect(await b.loadSurface('chat')).toEqual({ a: [msg('a1')], b: [msg('b1')], c: [msg('c1')] });
    expect(await b.loadSurface('cowork')).toEqual({ a: [msg('other')] });

    await b.remove('chat', 'b');
    const reopened = (await openIdbTranscriptBackend(idb))!;
    expect(Object.keys(await reopened.loadSurface('chat'))).toEqual(['a', 'c']);

    await reopened.clear();
    expect(await reopened.loadSurface('chat')).toEqual({});
    expect(await reopened.loadSurface('cowork')).toEqual({});
  });

  it('a value that cannot be stored rejects instead of throwing synchronously', async () => {
    const b = (await openIdbTranscriptBackend(fakeIndexedDB()))!;
    // Functions are not structured-cloneable; IndexedDB throws DataCloneError from put().
    await expect(b.put('chat', 'a', [{ id: 'x', fn: () => {} }])).rejects.toBeTruthy();
  });
});
