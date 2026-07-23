/**
 * Local JSONL event buffer.
 * Accumulates analytics events in memory and, when delivery fails, persists
 * them to disk (under Electron's userData dir, or the app data dir in dev) so they
 * can be retried on the next flush.
 */

import type { AnalyticsEvent } from './analytics-client';
import { sendEvents } from './analytics-client';
import { getDataDir } from '@/lib/app-paths';

const BUFFER_FILENAME = 'analytics-buffer.jsonl';
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let memoryBuffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let bufferFilePath: string | null = null;

/**
 * Resolve the on-disk buffer location. In packaged builds the Electron main
 * process passes its userData dir via QUARRY_USER_DATA_DIR — we land the
 * buffer under `<userData>/telemetry/`. Dev mode falls back to the app data dir.
 * Either way we mkdir the parent so appendFile never silently ENOENTs.
 */
async function getBufferPath(): Promise<string> {
  if (bufferFilePath) return bufferFilePath;
  try {
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs/promises');
    const userDataDir = process.env.AIME_USER_DATA_DIR;
    const dir = userDataDir
      ? path.join(userDataDir, 'telemetry')
      : getDataDir();
    await fs.mkdir(dir, { recursive: true });
    bufferFilePath = path.join(dir, BUFFER_FILENAME);
  } catch {
    bufferFilePath = `/tmp/${BUFFER_FILENAME}`;
  }
  return bufferFilePath;
}

/** Add an event to the in-memory buffer. */
export function queueEvent(event: AnalyticsEvent): void {
  memoryBuffer.push(event);
}

/** Write current buffer to JSONL file. */
export async function persistBuffer(): Promise<void> {
  if (memoryBuffer.length === 0) return;
  try {
    const fs = await import('fs/promises');
    const path = await getBufferPath();
    const lines = memoryBuffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(path, lines, 'utf-8');
  } catch (err) {
    // Non-fatal — buffer lives in memory. Log so a misconfigured path doesn't
    // silently shred undeliverable events the way it used to.
    console.warn('[telemetry] failed to persist buffer to disk:', err instanceof Error ? err.message : err);
  }
}

/** Flush buffer: send in-memory events, persist to disk on failure for retry. */
export async function flushBuffer(): Promise<void> {
  if (memoryBuffer.length === 0) {
    await sendPersistedEvents();
    return;
  }
  const toSend = [...memoryBuffer];
  memoryBuffer = [];
  const ok = await sendEvents(toSend);
  if (!ok) {
    memoryBuffer = [...toSend, ...memoryBuffer];
    await persistBuffer();
  }
}

/** Send events from the on-disk JSONL buffer, clearing only on success. */
async function sendPersistedEvents(): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const path = await getBufferPath();
    let content: string;
    try {
      content = await fs.readFile(path, 'utf-8');
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
      await fs.writeFile(path, '', 'utf-8');
    }
    // On failure leave the file alone — next flush retries the same batch.
  } catch {
    // Non-fatal
  }
}

/** Start the periodic flush timer (call once on app init). */
export function startBufferFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushBuffer().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

/** Stop the flush timer and flush immediately (call on app quit). */
export async function stopBufferFlushTimer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}
