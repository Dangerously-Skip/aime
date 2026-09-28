/**
 * Local JSONL event buffer.
 * Accumulates analytics events in memory and, when delivery fails, persists
 * them to disk (under Electron's userData dir, or the app data dir in dev) so they
 * can be retried on the next flush.
 *
 * Telemetry is OFF unless `ANALYTICS_API_URL` is set, and off means off: no
 * queueing, no timer, no file. The previous version buffered regardless, and
 * with no URL every flush failed, put the batch back in memory and appended the
 * WHOLE memory buffer to the file again — memory grew without bound and the
 * file grew quadratically, on every install that never opted in.
 *
 * When enabled but failing, a failed batch is moved to disk exactly once and
 * dropped from memory; the file is capped (oldest lines dropped) so an
 * endpoint that is down for a month cannot fill the disk.
 */

import type { AnalyticsEvent } from './analytics-client';
import { isTelemetryEnabled, sendEvents } from './analytics-client';
import { getDataDir } from '@/lib/app-paths';

const BUFFER_FILENAME = 'analytics-buffer.jsonl';
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** In-memory ceiling between flushes; oldest dropped beyond it. */
export const MAX_MEMORY_EVENTS = 1_000;
/** On-disk ceilings for undeliverable events; oldest lines dropped beyond either. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_EVENTS = 10_000;

let memoryBuffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let bufferFilePath: string | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Resolve the on-disk buffer location. In packaged builds the Electron main
 * process passes its userData dir via AIME_USER_DATA_DIR — we land the
 * buffer under `<userData>/telemetry/`. Dev mode falls back to the app data dir.
 * Either way we mkdir the parent so appendFile never silently ENOENTs.
 */
async function getBufferPath(): Promise<string> {
  if (bufferFilePath) return bufferFilePath;
  const path = await import('path');
  const fs = await import('fs/promises');
  const userDataDir = process.env.AIME_USER_DATA_DIR;
  const dir = userDataDir ? path.join(userDataDir, 'telemetry') : getDataDir();
  await fs.mkdir(dir, { recursive: true });
  bufferFilePath = path.join(dir, BUFFER_FILENAME);
  return bufferFilePath;
}

/**
 * Add an event to the in-memory buffer. Returns false (and keeps nothing)
 * when telemetry is disabled.
 */
export function queueEvent(event: AnalyticsEvent): boolean {
  if (!isTelemetryEnabled()) return false;
  memoryBuffer.push(event);
  if (memoryBuffer.length > MAX_MEMORY_EVENTS) {
    memoryBuffer.splice(0, memoryBuffer.length - MAX_MEMORY_EVENTS);
  }
  return true;
}

/** Keep the newest lines that fit both caps. */
function capLines(lines: string[]): string[] {
  let kept = lines.length > MAX_FILE_EVENTS ? lines.slice(-MAX_FILE_EVENTS) : lines;
  let bytes = kept.reduce((n, l) => n + Buffer.byteLength(l, 'utf-8') + 1, 0);
  let start = 0;
  while (bytes > MAX_FILE_BYTES && start < kept.length) {
    bytes -= Buffer.byteLength(kept[start], 'utf-8') + 1;
    start++;
  }
  if (start > 0) kept = kept.slice(start);
  return kept;
}

/** Append a failed batch to the JSONL file, then enforce the caps. */
async function appendToDisk(events: AnalyticsEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const fs = await import('fs/promises');
    const file = await getBufferPath();
    await fs.appendFile(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    // At most one read per failed flush, of a file capped at MAX_FILE_BYTES.
    const lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
    const kept = capLines(lines);
    if (kept.length === lines.length) return;
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, kept.length ? kept.join('\n') + '\n' : '', 'utf-8');
    await fs.rename(tmp, file);
  } catch (err) {
    // Non-fatal. The batch is dropped rather than retained in memory: holding
    // it is exactly how the old version grew without bound.
    console.warn('[telemetry] failed to persist buffer to disk:', err instanceof Error ? err.message : err);
  }
}

/** Move whatever is in memory to disk (e.g. on quit when delivery failed). */
export async function persistBuffer(): Promise<void> {
  const batch = memoryBuffer;
  memoryBuffer = [];
  await appendToDisk(batch);
}

async function flushOnce(): Promise<void> {
  if (!isTelemetryEnabled()) {
    memoryBuffer = [];
    return;
  }
  const batch = memoryBuffer;
  memoryBuffer = [];
  if (batch.length > 0) {
    const ok = await sendEvents(batch);
    if (!ok) {
      // The endpoint is failing; retrying the backlog now would fail too.
      await appendToDisk(batch);
      return;
    }
  }
  await sendPersistedEvents();
}

/**
 * Flush: send in-memory events, move them to disk on failure, then retry the
 * disk backlog. Single-flight — concurrent callers share one flush, so two
 * flushes never read, send and truncate the same file at once.
 */
export function flushBuffer(): Promise<void> {
  if (!inFlight) {
    inFlight = flushOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Send events from the on-disk JSONL buffer, clearing only on success. */
async function sendPersistedEvents(): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const file = await getBufferPath();
    let content: string;
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch {
      return; // file doesn't exist yet
    }
    const events: AnalyticsEvent[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    if (events.length === 0) return;
    const ok = await sendEvents(events);
    if (ok) {
      await fs.writeFile(file, '', 'utf-8');
    }
    // On failure leave the file alone — next flush retries the same batch.
  } catch {
    // Non-fatal
  }
}

/**
 * Start the periodic flush timer (call once on app init). A no-op when
 * telemetry is disabled — there is nothing to deliver and nowhere to send it.
 */
export function startBufferFlushTimer(): boolean {
  if (flushTimer) return true;
  if (!isTelemetryEnabled()) return false;
  flushTimer = setInterval(() => {
    flushBuffer().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Never hold the process open just to flush telemetry.
  flushTimer.unref?.();
  return true;
}

/** Stop the flush timer and flush immediately (call on app quit). */
export async function stopBufferFlushTimer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}

/** Test seam: reset module state and point the file somewhere disposable. */
export function __resetEventBufferForTests(filePath: string | null = null): void {
  memoryBuffer = [];
  bufferFilePath = filePath;
  inFlight = null;
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

/** Test seam: how many events are held in memory right now. */
export function __memoryBufferLength(): number {
  return memoryBuffer.length;
}
