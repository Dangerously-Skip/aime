import { STORAGE_PREFIX } from '@/config/branding';
import type { Transcript, TranscriptBackend } from './backend';

/**
 * Transcripts in IndexedDB — a hand-rolled wrapper, because the one API it
 * needs is five calls and a dependency for it is not worth carrying.
 *
 * One object store, one record per conversation, keyed `<surface>\0<chatId>`
 * so a surface's conversations are one contiguous key range. Writing a
 * conversation touches that record and nothing else, which is the point: the
 * localStorage path re-serialised every conversation of the surface on every
 * change.
 */

const DB_NAME = `${STORAGE_PREFIX}-transcripts`;
const DB_VERSION = 1;
const STORE = 'transcripts';
const SEP = '\u0000';

interface TranscriptRecord {
  surface: string;
  chatId: string;
  messages: Transcript;
  savedAt: number;
}

const keyOf = (surface: string, chatId: string) => `${surface}${SEP}${chatId}`;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export interface IdbDeps {
  factory?: IDBFactory;
  keyRange?: typeof IDBKeyRange;
  /** How long to wait for the database before giving up on it for this session. */
  timeoutMs?: number;
}

function wrap(db: IDBDatabase, keyRange: typeof IDBKeyRange): TranscriptBackend {
  // Every call opens its own transaction: `db.transaction` throws when the
  // connection has been closed under us, and a rejected promise is what the
  // storage above knows how to handle.
  const write = async (fn: (store: IDBObjectStore) => void) => {
    const tx = db.transaction(STORE, 'readwrite');
    const done = committed(tx);
    try {
      // `put` throws synchronously on a value it cannot clone.
      fn(tx.objectStore(STORE));
    } catch (error) {
      done.catch(() => {});
      try {
        tx.abort();
      } catch {
        // already finished
      }
      throw error;
    }
    await done;
  };
  const record = (surface: string, chatId: string, messages: Transcript): TranscriptRecord => ({
    surface,
    chatId,
    messages,
    savedAt: Date.now(),
  });

  return {
    async loadSurface(surface) {
      const tx = db.transaction(STORE, 'readonly');
      const range = keyRange.bound(`${surface}${SEP}`, `${surface}\u0001`, false, true);
      const rows = (await request(tx.objectStore(STORE).getAll(range))) as TranscriptRecord[];
      const out: Record<string, Transcript> = {};
      for (const row of rows) out[row.chatId] = row.messages;
      return out;
    },
    put: (surface, chatId, messages) =>
      write((store) => {
        store.put(record(surface, chatId, messages), keyOf(surface, chatId));
      }),
    putMany: (surface, entries) =>
      write((store) => {
        for (const [chatId, messages] of Object.entries(entries)) {
          store.put(record(surface, chatId, messages), keyOf(surface, chatId));
        }
      }),
    remove: (surface, chatId) =>
      write((store) => {
        store.delete(keyOf(surface, chatId));
      }),
    clear: () =>
      write((store) => {
        store.clear();
      }),
  };
}

/**
 * Open the transcript database, or `null` when there is none to be had —
 * no `indexedDB` (tests, some private modes), an open that errors, or one that
 * never settles. `null` sends the stores down the localStorage path they have
 * always used, so the failure costs the new capacity and nothing else.
 */
export function openIdbTranscriptBackend(deps: IdbDeps = {}): Promise<TranscriptBackend | null> {
  const factory = deps.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  const keyRange = deps.keyRange ?? (typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange);
  if (!factory || !keyRange) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (backend: TranscriptBackend | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(backend);
    };
    // Another window mid-upgrade can leave the open "blocked" indefinitely.
    // Waiting on it would hold every conversation off screen.
    const timer = setTimeout(() => finish(null), deps.timeoutMs ?? 5000);

    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch {
      finish(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      // A newer version elsewhere asks us to step aside; the storage above
      // sees the next transaction fail and keeps its state in memory.
      db.onversionchange = () => db.close();
      finish(wrap(db, keyRange));
    };
    req.onerror = () => finish(null);
  });
}

let shared: Promise<TranscriptBackend | null> | null = null;

/** The one database connection every conversation store shares. */
export function getTranscriptBackend(): Promise<TranscriptBackend | null> {
  if (!shared) shared = openIdbTranscriptBackend();
  return shared;
}
