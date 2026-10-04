/**
 * Where conversation transcripts live, one record per conversation.
 *
 * An interface rather than IndexedDB calls in the storage itself so the logic
 * that matters — migration order, per-conversation isolation, the streaming
 * skip — is tested against a real implementation of the contract, not a mock
 * of IDB's event soup. `idb-backend.ts` is the production implementation;
 * `createMemoryTranscriptBackend` is the same contract in a Map.
 */

/** One conversation's messages. Opaque here: the stores own the shape. */
export type Transcript = unknown[];

export interface TranscriptBackend {
  /** Every conversation stored for a surface, keyed by conversation id. */
  loadSurface(surface: string): Promise<Record<string, Transcript>>;
  put(surface: string, chatId: string, messages: Transcript): Promise<void>;
  /** All-or-nothing: one transaction, so a crash leaves none or all of them. */
  putMany(surface: string, entries: Record<string, Transcript>): Promise<void>;
  remove(surface: string, chatId: string): Promise<void>;
  /** Every surface's transcripts. "Clear all data" — nothing else. */
  clear(): Promise<void>;
}

/**
 * The contract in memory. Values are structured-cloned on the way in and out,
 * as IndexedDB does, so a test cannot pass by holding a reference to the very
 * array it later asserts on.
 */
export function createMemoryTranscriptBackend(): TranscriptBackend & { records: Map<string, Transcript> } {
  const records = new Map<string, Transcript>();
  const key = (surface: string, chatId: string) => `${surface}\u0000${chatId}`;
  return {
    records,
    async loadSurface(surface) {
      const out: Record<string, Transcript> = {};
      const prefix = `${surface}\u0000`;
      for (const [k, v] of records) {
        if (k.startsWith(prefix)) out[k.slice(prefix.length)] = structuredClone(v);
      }
      return out;
    },
    async put(surface, chatId, messages) {
      records.set(key(surface, chatId), structuredClone(messages));
    },
    async putMany(surface, entries) {
      const cloned = Object.entries(entries).map(([id, m]) => [key(surface, id), structuredClone(m)] as const);
      for (const [k, v] of cloned) records.set(k, v);
    },
    async remove(surface, chatId) {
      records.delete(key(surface, chatId));
    },
    async clear() {
      records.clear();
    },
  };
}
