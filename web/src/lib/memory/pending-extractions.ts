import 'server-only';
// ^ Reaches the filesystem. The renderer's half is `pending-pull.ts`.

/**
 * Memories extracted after a turn's stream has closed, waiting for the renderer
 * to store them — on disk, so a restart cannot drop them.
 *
 * Extraction runs AFTER the stream closes (it used to hold the composer locked
 * for a whole extra model call), so its result has no stream to ride on, and
 * the memory store lives in the renderer. This queue is the hand-off.
 *
 * It used to be an in-process Map drained by the NEXT turn of the SAME
 * conversation. Three ways that lost memories or hid them:
 *
 *   - quitting before that turn dropped them (the Map died with the process);
 *   - a conversation never resumed meant they were never delivered at all;
 *   - even when it worked, a memory was invisible until you spoke again.
 *
 * Now each memory is persisted under its own id and the renderer PULLS
 * (`GET /api/memory/pending`) on start and after every turn, then
 * acknowledges by id (`DELETE`). An item leaves the file only once the
 * renderer says it stored it, so a crash between read and store re-delivers
 * rather than loses — and the renderer keys the stored memory on the same id,
 * which makes re-delivery a no-op.
 *
 * Writes go through `updateJsonFile`: a per-file lock (so a stash and an ack
 * that interleave cannot drop each other's change) and temp-file + rename (so
 * a crash mid-write cannot leave a torn file).
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir } from '@/lib/app-paths';
import { updateJsonFile, SKIP_WRITE } from '@/lib/mcp/config-store';
import type { PendingMemory } from './types';

export interface ExtractedMemoryPayload {
  content: string;
  category: string;
  tags: string[];
  confidence: number;
}

interface PendingFile {
  items: PendingMemory[];
}

/**
 * A bound, not a policy: nothing should get near it, since every app start
 * drains the queue. It only matters if the renderer stops acknowledging, and
 * then the oldest go first.
 */
export const PENDING_LIMIT = 500;

const FILE_NAME = 'pending-memories.json';

/** ~/.aime/pending-memories.json */
export function pendingMemoriesPath(): string {
  return path.join(getDataDir(), FILE_NAME);
}

function isPendingMemory(v: unknown): v is PendingMemory {
  const m = v as Partial<PendingMemory> | null;
  return Boolean(
    m &&
      typeof m === 'object' &&
      typeof m.id === 'string' &&
      typeof m.chatId === 'string' &&
      typeof m.content === 'string' &&
      typeof m.category === 'string' &&
      Array.isArray(m.tags) &&
      typeof m.confidence === 'number' &&
      typeof m.createdAt === 'number',
  );
}

const emptyFile = (): PendingFile => ({ items: [] });

/** A file another version wrote, or a hand edit: keep only well-formed items. */
function itemsOf(data: Partial<PendingFile>): PendingMemory[] {
  return Array.isArray(data.items) ? data.items.filter(isPendingMemory) : [];
}

/** Queue memories extracted from `chatId`'s turn. Returns the queued items. */
export async function stashExtractedMemories(
  chatId: string,
  memories: ExtractedMemoryPayload[],
): Promise<PendingMemory[]> {
  if (!chatId || memories.length === 0) return [];
  const now = Date.now();
  const added: PendingMemory[] = memories.map((m) => ({
    id: randomUUID(),
    chatId,
    createdAt: now,
    content: m.content,
    category: m.category,
    tags: Array.isArray(m.tags) ? m.tags : [],
    confidence: m.confidence,
  }));
  await updateJsonFile<PendingFile, void>(pendingMemoriesPath(), emptyFile, (data) => {
    data.items = [...itemsOf(data), ...added].slice(-PENDING_LIMIT);
  });
  return added;
}

/** Everything not yet acknowledged, oldest first. A missing or unreadable file is an empty queue. */
export async function listPendingMemories(): Promise<PendingMemory[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(pendingMemoriesPath(), 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return itemsOf(parsed as Partial<PendingFile>);
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * The renderer stored these: forget them. Unknown ids are ignored, so a
 * repeated ack (two pulls racing) is harmless. Returns how many were removed.
 */
export async function ackPendingMemories(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const drop = new Set(ids);
  const removed = await updateJsonFile<PendingFile, number | typeof SKIP_WRITE>(
    pendingMemoriesPath(),
    emptyFile,
    (data) => {
      const before = itemsOf(data);
      const kept = before.filter((m) => !drop.has(m.id));
      if (kept.length === before.length) return SKIP_WRITE;
      data.items = kept;
      return before.length - kept.length;
    },
  );
  return typeof removed === 'number' ? removed : 0;
}

// ── in flight ────────────────────────────────────────────────────────────────

/**
 * Extractions that have been queued but not finished.
 *
 * The renderer pulls as soon as a turn's `done` arrives — which is BEFORE the
 * extraction has even started, since it runs after the stream closes. Rather
 * than have the client guess a delay, the pull may wait (bounded) for these to
 * settle. On globalThis because the chat route and the pull route are separate
 * bundles, and Next can load a lib module once per bundle: two counters would
 * be none.
 */
interface InFlight {
  count: number;
  /** Bumped by the test reset, so a release from before it cannot drive `count` negative. */
  generation: number;
  waiters: Set<() => void>;
}
const IN_FLIGHT = Symbol.for('aime.memory.pendingExtractions.inFlight');

function inFlight(): InFlight {
  const g = globalThis as Record<symbol, InFlight | undefined>;
  return (g[IN_FLIGHT] ??= { count: 0, generation: 0, waiters: new Set() });
}

/**
 * Mark an extraction as started. Call it BEFORE the turn's `done` is written,
 * so a pull triggered by that `done` already sees it; call the returned
 * function (idempotent) once the result is stashed or abandoned.
 */
export function beginExtraction(): () => void {
  const state = inFlight();
  state.count += 1;
  const generation = state.generation;
  let ended = false;
  return () => {
    if (ended || generation !== state.generation) return;
    ended = true;
    state.count -= 1;
    if (state.count === 0) {
      for (const wake of [...state.waiters]) wake();
    }
  };
}

/**
 * Resolve once no extraction is in flight, after `timeoutMs`, or when `signal`
 * aborts — whichever comes first. Never rejects.
 */
export function extractionsSettled(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const state = inFlight();
  if (state.count === 0 || timeoutMs <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', wake);
      state.waiters.delete(wake);
      resolve();
    };
    const timer = setTimeout(wake, timeoutMs);
    signal?.addEventListener('abort', wake);
    state.waiters.add(wake);
  });
}

/** Test seam: forget in-flight bookkeeping. The file is the caller's (use a temp home). */
export function resetPendingExtractions(): void {
  const state = inFlight();
  for (const wake of [...state.waiters]) wake();
  state.count = 0;
  state.generation += 1;
}
