import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { SESSION_COOKIE } from '@/lib/auth/local-token';
import {
  beginExtraction,
  listPendingMemories,
  resetPendingExtractions,
  stashExtractedMemories,
} from '@/lib/memory/pending-extractions';
import { GET, DELETE } from './route';

// The real queue, on real files in a temp data dir.
const dataDir = vi.hoisted(() => ({ value: '' }));
vi.mock('@/lib/app-paths', () => ({ getDataDir: () => dataDir.value }));

const BASE = 'http://localhost:19533/api/memory/pending';
const get = (query = '') => GET(new NextRequest(`${BASE}${query}`));
const del = (body: unknown) =>
  DELETE(
    new NextRequest(BASE, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const mem = (content: string) => ({ content, category: 'fact', tags: [], confidence: 0.8 });

beforeEach(async () => {
  dataDir.value = await mkdtemp(path.join(os.tmpdir(), 'aime-pending-route-'));
  resetPendingExtractions();
});
afterEach(async () => {
  resetPendingExtractions();
  await rm(dataDir.value, { recursive: true, force: true });
});

describe('the proxy guards /api/memory/pending', () => {
  const TOKEN = 'd'.repeat(64);
  beforeEach(() => vi.stubEnv('AIME_API_TOKEN', TOKEN));
  afterEach(() => vi.unstubAllEnvs());
  const req = (method: string, headers: Record<string, string> = {}) =>
    new NextRequest(new Request(BASE, { method, headers }));

  it.each(['GET', 'DELETE'])('refuses an unauthenticated %s', async (method) => {
    expect((await proxy(req(method))).status).toBe(401);
  });

  it('refuses a cross-site request even carrying the session cookie', async () => {
    const res = await proxy(
      req('DELETE', { cookie: `${SESSION_COOKIE}=${TOKEN}`, origin: 'https://evil.example', host: 'localhost:19533' }),
    );
    expect(res.status).toBe(403);
  });

  it('lets the app through', async () => {
    const res = await proxy(req('GET', { cookie: `${SESSION_COOKIE}=${TOKEN}` }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/memory/pending', () => {
  it('returns what is queued, with ids, and does not consume it', async () => {
    const [a] = await stashExtractedMemories('c1', [mem('User works on AIME')]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).items).toEqual([expect.objectContaining({ id: a.id, chatId: 'c1', content: 'User works on AIME' })]);
    expect((await (await get()).json()).items).toHaveLength(1);
  });

  it('is an empty list when nothing is queued', async () => {
    expect(await (await get()).json()).toEqual({ items: [] });
  });

  it('waits for an extraction in flight, so the post-turn pull gets its result', async () => {
    const settle = beginExtraction();
    const pending = get('?wait=10000');
    setTimeout(async () => {
      await stashExtractedMemories('c1', [mem('learned just now')]);
      settle();
    }, 20);
    const body = await (await pending).json();
    expect(body.items.map((i: { content: string }) => i.content)).toEqual(['learned just now']);
  });

  it('caps the wait however long is asked for', async () => {
    vi.useFakeTimers();
    try {
      beginExtraction(); // never settles
      const pending = get('?wait=999999');
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pending).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['?wait=-1', '?wait=abc', '?wait=1.5', '?wait=10000000'])('rejects %s', async (q) => {
    expect((await get(q)).status).toBe(400);
  });
});

describe('DELETE /api/memory/pending', () => {
  it('acknowledges by id, leaving the rest queued', async () => {
    const [a, b] = await stashExtractedMemories('c1', [mem('a'), mem('b')]);
    const res = await del({ ids: [a.id] });
    expect(await res.json()).toEqual({ removed: 1 });
    expect((await listPendingMemories()).map((i) => i.id)).toEqual([b.id]);
  });

  it('is idempotent', async () => {
    const [a] = await stashExtractedMemories('c1', [mem('a')]);
    await del({ ids: [a.id] });
    const again = await del({ ids: [a.id] });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ removed: 0 });
  });

  it.each([
    ['not JSON', 'nope'],
    ['no ids', {}],
    ['empty ids', { ids: [] }],
    ['non-string id', { ids: [1] }],
    ['path-like id', { ids: ['../../etc'] }],
    ['too many ids', { ids: Array.from({ length: 1001 }, (_, i) => `id-${i}`) }],
  ])('rejects %s', async (_label, body) => {
    expect((await del(body)).status).toBe(400);
  });
});
