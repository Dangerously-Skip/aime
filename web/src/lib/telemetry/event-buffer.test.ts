import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  queueEvent,
  flushBuffer,
  startBufferFlushTimer,
  stopBufferFlushTimer,
  MAX_MEMORY_EVENTS,
  MAX_FILE_EVENTS,
  __resetEventBufferForTests,
  __memoryBufferLength,
} from './event-buffer';
import type { AnalyticsEvent } from './analytics-client';

/**
 * Real JSONL file in a temp dir; the network is the only thing stubbed (fetch).
 *
 * REGRESSION: with ANALYTICS_API_URL unset — the default — every flush failed,
 * put the batch back in memory and appended the WHOLE memory buffer to the file
 * again. N flushes of the same events wrote them N times, and memory never
 * shrank.
 */
let dir: string;
let file: string;
let seq = 0;
const ev = (): AnalyticsEvent => ({
  schema_version: '1.0',
  event_type: 'test',
  timestamp: new Date(0).toISOString(),
  identity: {},
  data: { n: seq++ },
});

const readLines = async (): Promise<string[]> => {
  try {
    return (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

const fetchMock = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aime-telemetry-'));
  file = path.join(dir, 'analytics-buffer.jsonl');
  __resetEventBufferForTests(file);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // SigV4 signing resolves credentials; give it env ones so it never probes IMDS.
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDEXAMPLE');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  __resetEventBufferForTests(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('telemetry disabled (no ANALYTICS_API_URL)', () => {
  beforeEach(() => vi.stubEnv('ANALYTICS_API_URL', ''));

  it('queues nothing, writes nothing, sends nothing, schedules nothing', async () => {
    for (let i = 0; i < 50; i++) expect(queueEvent(ev())).toBe(false);
    expect(__memoryBufferLength()).toBe(0);
    for (let i = 0; i < 5; i++) await flushBuffer();
    expect(await readLines()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(startBufferFlushTimer()).toBe(false);
  });
});

describe('telemetry enabled', () => {
  beforeEach(() => vi.stubEnv('ANALYTICS_API_URL', 'https://ingest.example.test'));

  it('repeated failed flushes neither grow memory nor duplicate lines', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));
    for (let i = 0; i < 3; i++) queueEvent(ev());
    await flushBuffer();
    expect(__memoryBufferLength()).toBe(0);
    expect(await readLines()).toHaveLength(3);

    for (let i = 0; i < 10; i++) await flushBuffer();
    expect(__memoryBufferLength()).toBe(0);
    expect(await readLines()).toHaveLength(3);

    for (let i = 0; i < 2; i++) queueEvent(ev());
    await flushBuffer();
    const lines = await readLines();
    expect(lines).toHaveLength(5);
    expect(new Set(lines).size).toBe(5);
  });

  it('delivers the disk backlog once the endpoint recovers, then clears it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    queueEvent(ev());
    await flushBuffer();
    expect(await readLines()).toHaveLength(1);

    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    queueEvent(ev());
    await flushBuffer();
    // memory batch, then the one persisted event
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await readLines()).toEqual([]);
    expect(__memoryBufferLength()).toBe(0);
  });

  it('caps the in-memory buffer between flushes', () => {
    for (let i = 0; i < MAX_MEMORY_EVENTS + 250; i++) queueEvent(ev());
    expect(__memoryBufferLength()).toBe(MAX_MEMORY_EVENTS);
  });

  it('caps the file, dropping the oldest lines', async () => {
    const old = Array.from({ length: MAX_FILE_EVENTS }, (_, i) => JSON.stringify({ old: i }));
    await fs.writeFile(file, old.join('\n') + '\n');
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    for (let i = 0; i < 5; i++) queueEvent(ev());
    await flushBuffer();
    const lines = await readLines();
    expect(lines).toHaveLength(MAX_FILE_EVENTS);
    expect(lines[0]).toBe(JSON.stringify({ old: 5 }));
  });

  it('concurrent flushes share one send', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    queueEvent(ev());
    await Promise.all([flushBuffer(), flushBuffer(), flushBuffer()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts the timer only once and stops it', async () => {
    expect(startBufferFlushTimer()).toBe(true);
    expect(startBufferFlushTimer()).toBe(true);
    await stopBufferFlushTimer();
  });
});
