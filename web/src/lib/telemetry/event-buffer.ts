/**
 * Local JSONL event buffer.
 * Accumulates analytics events in memory and persists them to
 * ~/.claude/analytics-buffer.jsonl on flush.
 */

import type { AnalyticsEvent } from './analytics-client';
import { sendEvents } from './analytics-client';

const BUFFER_PATH_SEGMENT = '.claude/analytics-buffer.jsonl';
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let memoryBuffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let bufferFilePath: string | null = null;

async function getBufferPath(): Promise<string> {
  if (bufferFilePath) return bufferFilePath;
  try {
    const os = await import('os');
    const path = await import('path');
    bufferFilePath = path.join(os.homedir(), BUFFER_PATH_SEGMENT);
  } catch {
    bufferFilePath = `/tmp/analytics-buffer.jsonl`;
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
  } catch {
    // Non-fatal — buffer lives in memory
  }
}

/** Flush buffer: write to disk and attempt to send to analytics pipeline. */
export async function flushBuffer(): Promise<void> {
  if (memoryBuffer.length === 0) {
    // Try sending any previously-persisted events
    await sendPersistedEvents();
    return;
  }
  const toSend = [...memoryBuffer];
  memoryBuffer = [];
  try {
    await sendEvents(toSend);
  } catch {
    // Put them back on failure
    memoryBuffer = [...toSend, ...memoryBuffer];
    await persistBuffer();
  }
}

/** Send events from the on-disk JSONL buffer, then clear it. */
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
    await sendEvents(events);
    await fs.writeFile(path, '', 'utf-8'); // clear
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
