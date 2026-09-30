import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { getGatedStorage, isStorageGateOpen } from '@/lib/gated-storage';
import { createThrottledJSONStorage } from '@/lib/throttled-storage';
import type { Transcript, TranscriptBackend } from './backend';
import { getTranscriptBackend } from './idb-backend';

/**
 * A zustand `persist` storage that keeps transcripts out of localStorage.
 *
 * WHY. Every conversation's full transcript, tool output included, used to sit
 * in localStorage: one ~5MB budget for the whole origin, written synchronously
 * on the main thread, the entire surface's history re-serialised on every
 * change. Throttling (lib/throttled-storage) made that bearable while
 * streaming; it did nothing about the ceiling, and hitting the ceiling is the
 * failure lib/runs/run-log.ts warns "costs the user their chat history".
 *
 * WHAT. The store still persists through one `persist` call, and still sees
 * `messages` as one map. Underneath, the value is split:
 *
 *   - `messages` goes to IndexedDB, one record per conversation. A change
 *     writes the conversations whose array changed — by reference, which
 *     zustand's immutable updates make exact — and nothing else.
 *   - everything else (current chat, folders, session controls…) stays in
 *     localStorage exactly as before, through the throttled storage.
 *
 * `getItem` puts the two back together, so rehydration — and so
 * `useRehydrated` in store-hydration — still means "the transcripts are here".
 * All of them, not lazily: the sidebar's full-text search reads every
 * conversation's messages, and loading them up front keeps that working with
 * no second index to keep in step.
 *
 * WHEN a conversation is written:
 *   - coalesced per conversation, at most once per `debounceMs`;
 *   - never while that conversation is mid-turn (a reply is one change per
 *     token) — the moment the turn ends it is written at once; a turn that runs
 *     long is checkpointed every `checkpointMs` so a crash cannot take all of it;
 *   - everything pending is written on `pagehide` / `beforeunload`;
 *   - never before the storage gate opens (see lib/gated-storage), for the same
 *     reason localStorage waits: before rehydration, state is defaults.
 *
 * MIGRATION. A localStorage payload that still carries `messages` is copied into
 * IndexedDB in one transaction, read back and compared, and only then rewritten
 * without them. A crash anywhere in that sequence leaves the localStorage copy
 * in place and the next launch simply does it again; localStorage wins any
 * conversation both hold, since it can only be there if IndexedDB was not being
 * written.
 *
 * FAILURE. No IndexedDB at all (tests, some private modes), an open that never
 * settles, or a migration that does not verify: the store runs on the
 * localStorage path it always used, transcripts included. A single write that
 * fails is reported once and retried the next time that conversation changes;
 * it never throws into the stream handler that caused it.
 */

export type TranscriptStorageMode = 'pending' | 'idb' | 'local';

export interface TranscriptStorageOptions {
  /** Record namespace: 'chat', 'cowork', 'code', 'browser'. */
  surface: string;
  /** Where the non-transcript state lives: the gated localStorage. */
  local: () => Storage;
  /**
   * Ungated localStorage, used once: to rewrite a payload whose transcripts
   * have just been verified in IndexedDB. The gate stops DEFAULT state being
   * written over saved state; this writes the saved state itself, minus what
   * was moved, and has to happen during rehydration, when the gate is shut.
   */
  rawLocal?: () => Storage;
  backend?: () => Promise<TranscriptBackend | null>;
  /** Any conversation mid-turn — throttles the localStorage half. */
  isBusy: () => boolean;
  /** This conversation mid-turn — holds its transcript write until the turn ends. */
  isStreaming: (chatId: string) => boolean;
  /** Defaults to the storage gate. */
  canWrite?: () => boolean;
  debounceMs?: number;
  checkpointMs?: number;
  /** Throttle interval for the localStorage half while busy. */
  intervalMs?: number;
}

export interface TranscriptStorage<S> extends PersistStorage<S> {
  /** Write everything pending now and wait for it to land. */
  flush(): Promise<void>;
  mode(): TranscriptStorageMode;
  /** Stop writing for good — "Clear all data" is about to reload the page. */
  freeze(): void;
}

type WithMessages = { messages?: Record<string, Transcript> };

/** Stands in for "we do not know what the backend holds for this one", so any value differs from it. */
const UNKNOWN: Transcript = [];

const live = new Set<{ freeze(): void }>();

function sameTranscript(a: Transcript | undefined, b: Transcript): boolean {
  if (!a || a.length !== b.length) return false;
  const id = (m: unknown) => (m as { id?: unknown } | null)?.id;
  return a.every((m, i) => id(m) === id(b[i]));
}

export function createTranscriptStorage<S extends WithMessages>(
  opts: TranscriptStorageOptions,
): TranscriptStorage<S> {
  const { surface } = opts;
  const debounceMs = opts.debounceMs ?? 1000;
  const checkpointMs = opts.checkpointMs ?? 30_000;
  const canWrite = opts.canWrite ?? isStorageGateOpen;
  const rawLocal = opts.rawLocal ?? (() => localStorage);
  const resolveBackend = opts.backend ?? getTranscriptBackend;
  const local = createThrottledJSONStorage<S>(opts.local, { isBusy: opts.isBusy, intervalMs: opts.intervalMs });

  let mode: TranscriptStorageMode = 'pending';
  let backend: TranscriptBackend | null = null;
  let frozen = false;
  /** The latest `messages` handed to setItem. */
  let latest: Record<string, Transcript> = {};
  /** What the backend holds, by reference: equal ⇒ nothing to write. */
  const saved = new Map<string, Transcript>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const checkpoints = new Map<string, ReturnType<typeof setTimeout>>();
  /** Changed mid-turn; written the moment the turn ends. */
  const held = new Set<string>();
  const inflight = new Set<Promise<void>>();
  const warned = new Set<string>();

  const warn = (kind: string, message: string, error: unknown) => {
    if (warned.has(kind)) return;
    warned.add(kind);
    console.warn(`[transcripts] ${surface}: ${message}`, error);
  };

  /** Own keys only: a conversation id is user-facing data, and `latest.constructor` exists. */
  const current = (chatId: string): Transcript | undefined =>
    Object.prototype.hasOwnProperty.call(latest, chatId) ? latest[chatId] : undefined;

  function cancel(chatId: string) {
    const t = timers.get(chatId);
    if (t !== undefined) clearTimeout(t);
    timers.delete(chatId);
    const c = checkpoints.get(chatId);
    if (c !== undefined) clearTimeout(c);
    checkpoints.delete(chatId);
  }

  /** Bring the backend's record for one conversation in line with `latest`. */
  function write(chatId: string) {
    cancel(chatId);
    if (!backend || frozen || !canWrite()) return;
    const cur = current(chatId);
    const prev = saved.get(chatId);
    if (cur === prev) return;

    let op: Promise<void>;
    try {
      if (cur === undefined) {
        saved.delete(chatId);
        op = backend.remove(surface, chatId);
      } else {
        saved.set(chatId, cur);
        op = backend.put(surface, chatId, cur);
      }
    } catch (error) {
      op = Promise.reject(error);
    }
    const tracked: Promise<void> = op
      .catch((error: unknown) => {
        // Not written. Mark it unknown so the next change of this conversation
        // — or its deletion — tries again, instead of believing it landed.
        if (cur === undefined ? !saved.has(chatId) : saved.get(chatId) === cur) saved.set(chatId, UNKNOWN);
        warn('write', 'a conversation could not be saved; it is kept in memory and retried on its next change.', error);
      })
      .finally(() => inflight.delete(tracked));
    inflight.add(tracked);
  }

  function schedule(chatId: string) {
    if (opts.isStreaming(chatId)) {
      held.add(chatId);
      const t = timers.get(chatId);
      if (t !== undefined) clearTimeout(t);
      timers.delete(chatId);
      if (checkpointMs > 0 && !checkpoints.has(chatId)) {
        checkpoints.set(
          chatId,
          setTimeout(() => {
            checkpoints.delete(chatId);
            write(chatId);
          }, checkpointMs),
        );
      }
      return;
    }
    if (!timers.has(chatId)) timers.set(chatId, setTimeout(() => write(chatId), debounceMs));
  }

  function reconcile() {
    // A turn that has just ended is written now, not after the debounce.
    for (const chatId of [...held]) {
      if (opts.isStreaming(chatId)) continue;
      held.delete(chatId);
      write(chatId);
    }
    for (const chatId of Object.keys(latest)) {
      if (latest[chatId] !== saved.get(chatId)) schedule(chatId);
    }
    for (const chatId of saved.keys()) {
      if (current(chatId) === undefined) schedule(chatId);
    }
  }

  function writeAllPending() {
    const ids = new Set([...timers.keys(), ...checkpoints.keys(), ...held]);
    held.clear();
    for (const chatId of ids) write(chatId);
  }

  async function migrate(name: string, b: TranscriptBackend, stored: StorageValue<S>, legacy: Record<string, Transcript>) {
    const ids = Object.keys(legacy);
    if (ids.length > 0) {
      await b.putMany(surface, legacy);
      const back = await b.loadSurface(surface);
      for (const id of ids) {
        if (!sameTranscript(back[id], legacy[id])) throw new Error(`conversation ${id} did not read back intact`);
      }
    }
    // Verified. Only now does localStorage give them up.
    const { messages: _moved, ...rest } = stored.state;
    try {
      rawLocal().setItem(name, JSON.stringify({ ...stored, state: rest }));
    } catch (error) {
      // Both copies exist; the next launch repeats the migration.
      warn('strip', 'moved transcripts are still in local storage and will be moved again next launch.', error);
    }
  }

  function onPageHide() {
    writeAllPending();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
  }

  const storage: TranscriptStorage<S> = {
    async getItem(name) {
      const stored = (await local.getItem(name)) as StorageValue<S> | null;
      const b = await resolveBackend().catch(() => null);
      if (!b) {
        mode = 'local';
        return stored;
      }
      try {
        const legacy = stored?.state?.messages;
        if (stored && legacy) await migrate(name, b, stored, legacy);
        const messages = await b.loadSurface(surface);
        backend = b;
        mode = 'idb';
        saved.clear();
        for (const [id, m] of Object.entries(messages)) saved.set(id, m);
        latest = messages;
        if (!stored && Object.keys(messages).length === 0) return null;
        // No stored payload means no version; zustand then skips `migrate`.
        return { ...stored, state: { ...stored?.state, messages } } as StorageValue<S>;
      } catch (error) {
        warn('open', 'transcript storage is unavailable; using local storage this session.', error);
        mode = 'local';
        return stored;
      }
    },

    setItem(name, value) {
      if (mode !== 'idb') return local.setItem(name, value);
      const { messages, ...rest } = value.state;
      local.setItem(name, { ...value, state: rest as S });
      if (frozen) return;
      latest = messages ?? {};
      reconcile();
    },

    removeItem(name) {
      local.removeItem(name);
      if (mode !== 'idb') return;
      latest = {};
      for (const chatId of [...saved.keys()]) write(chatId);
    },

    async flush() {
      writeAllPending();
      await Promise.allSettled([...inflight]);
    },

    mode: () => mode,

    freeze() {
      frozen = true;
      for (const chatId of [...timers.keys(), ...checkpoints.keys()]) cancel(chatId);
      held.clear();
    },
  };
  live.add(storage);
  return storage;
}

/**
 * The storage every conversation store uses: gated localStorage for its small
 * state, the shared transcript database for `messages`, and its own
 * `streamingChats` to know which conversations are mid-turn.
 */
export function surfaceTranscriptStorage<S extends WithMessages>(
  surface: string,
  streamingChats: () => Record<string, true>,
): TranscriptStorage<S> {
  return createTranscriptStorage<S>({
    surface,
    local: () => getGatedStorage(),
    isBusy: () => Object.keys(streamingChats()).length > 0,
    isStreaming: (chatId) => !!streamingChats()[chatId],
  });
}

/**
 * Delete every stored transcript, for "Clear all data". Stops every store's
 * pending writes first — otherwise the reload that follows fires `pagehide`,
 * which would faithfully save everything back.
 */
export async function clearAllTranscripts(
  resolveBackend: () => Promise<TranscriptBackend | null> = getTranscriptBackend,
): Promise<void> {
  for (const s of live) s.freeze();
  const b = await resolveBackend().catch(() => null);
  await b?.clear();
}
