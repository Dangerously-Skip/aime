/**
 * Recover the artifacts an aborted turn produced but never announced.
 *
 * Artifacts reach the UI as a side effect of the STREAM: a `Write` tool_use
 * event arrives, `categorizeToolCall` files it under Artifacts, and a card
 * appears. Kill the stream and that pipeline stops — but the agent's file writes
 * do not, because they already happened, or complete in the SDK subprocess after
 * the client has stopped reading.
 *
 * So an aborted turn reliably produces files that exist on disk and nowhere in
 * the UI. The 18-slide deck that prompted this was written at 23:46, seconds
 * after the watchdog killed the stream; the user was shown a timeout and told to
 * try again, with no indication the deck was finished and sitting in scratch.
 *
 * This closes that gap by asking the server what is actually there.
 */

interface ScratchFile {
  path: string;
  name: string;
  modifiedAt: number;
}

/**
 * When each chat's current turn began.
 *
 * Module-level rather than store state on purpose: it is only meaningful while
 * a stream is running, so persisting it would restore a stale window across a
 * restart and sweep old files into a new turn's artifacts.
 */
const turnStarts = new Map<string, number>();

export function markTurnStart(chatId: string, now = Date.now()): void {
  turnStarts.set(chatId, now);
}

/**
 * When the chat's turn began, or `undefined` if none was recorded — in which
 * case the caller must NOT reconcile. A missing start time is not "reconcile
 * everything": that would register every file from every previous turn.
 */
export function turnStartedAt(chatId: string): number | undefined {
  return turnStarts.get(chatId);
}

/**
 * Files in the chat's scratch directory that the UI does not already know about.
 *
 * @param known paths already registered as artifacts or context.
 * @param since epoch ms; only files touched at or after this are considered, so
 *   a reconcile does not sweep up every file from every previous turn. Callers
 *   pass the time the turn STARTED.
 *
 * Returns [] on any failure. A best-effort recovery must never be the thing that
 * breaks the abort path it runs inside — the turn is already going badly.
 */
export async function findUnregisteredArtifacts(
  chatId: string,
  known: readonly string[],
  since: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  let files: ScratchFile[];
  try {
    const response = await fetchImpl(
      `/api/scratch/artifacts?chatId=${encodeURIComponent(chatId)}`,
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    files = (body as { files?: ScratchFile[] })?.files ?? [];
    if (!Array.isArray(files)) return [];
  } catch {
    return [];
  }

  const seen = new Set(known);
  return files
    .filter((f) => typeof f?.path === 'string' && !seen.has(f.path))
    // `>=` not `>`: a file written in the same millisecond the turn started is
    // this turn's. The alternative silently drops it.
    .filter((f) => typeof f.modifiedAt === 'number' && f.modifiedAt >= since)
    .map((f) => f.path);
}
