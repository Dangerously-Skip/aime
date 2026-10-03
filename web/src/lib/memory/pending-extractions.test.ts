import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/*
 * Real files in a temp data dir — the property under test is that the queue
 * survives the process, so the filesystem is the boundary and is not mocked.
 */
const dataDir = vi.hoisted(() => ({ value: '' }));
vi.mock('@/lib/app-paths', () => ({ getDataDir: () => dataDir.value }));

type Mod = typeof import('./pending-extractions');
/** A fresh copy of the module, as a restarted process would load it. */
async function load(): Promise<Mod> {
  vi.resetModules();
  return import('./pending-extractions');
}

const mem = (content: string) => ({ content, category: 'fact', tags: ['t'], confidence: 0.7 });

let q: Mod;
beforeEach(async () => {
  dataDir.value = await mkdtemp(path.join(os.tmpdir(), 'aime-pending-mem-'));
  q = await load();
  q.resetPendingExtractions();
});
afterEach(async () => {
  q.resetPendingExtractions();
  await rm(dataDir.value, { recursive: true, force: true });
});

describe('the pending-memory queue', () => {
  it('survives a restart: a new module instance reads what the old one wrote', async () => {
    const [a] = await q.stashExtractedMemories('c1', [mem('User works on AIME')]);

    const restarted = await load();
    const items = await restarted.listPendingMemories();
    expect(items).toEqual([
      { id: a.id, chatId: 'c1', createdAt: a.createdAt, content: 'User works on AIME', category: 'fact', tags: ['t'], confidence: 0.7 },
    ]);
  });

  it('gives every item its own id, across conversations', async () => {
    await q.stashExtractedMemories('c1', [mem('a'), mem('b')]);
    await q.stashExtractedMemories('c2', [mem('c')]);
    const items = await q.listPendingMemories();
    expect(items.map((i) => [i.chatId, i.content])).toEqual([['c1', 'a'], ['c1', 'b'], ['c2', 'c']]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it('reading does not consume: only an ack removes, and only the ids acked', async () => {
    const [a, b] = await q.stashExtractedMemories('c1', [mem('a'), mem('b')]);
    await q.listPendingMemories();
    expect(await q.listPendingMemories()).toHaveLength(2);

    expect(await q.ackPendingMemories([a.id])).toBe(1);
    expect((await q.listPendingMemories()).map((i) => i.id)).toEqual([b.id]);

    // An ack that lands twice (two pulls racing) or names nothing known is harmless.
    expect(await q.ackPendingMemories([a.id, 'not-an-id'])).toBe(0);
    expect((await (await load()).listPendingMemories()).map((i) => i.id)).toEqual([b.id]);
  });

  it('does not lose an item when a stash and an ack interleave', async () => {
    const [a] = await q.stashExtractedMemories('c1', [mem('a')]);
    await Promise.all([
      q.ackPendingMemories([a.id]),
      q.stashExtractedMemories('c2', [mem('b')]),
      q.stashExtractedMemories('c3', [mem('c')]),
    ]);
    expect((await q.listPendingMemories()).map((i) => i.content).sort()).toEqual(['b', 'c']);
  });

  it('writes owner-only', async () => {
    await q.stashExtractedMemories('c1', [mem('a')]);
    expect((await stat(q.pendingMemoriesPath())).mode & 0o777).toBe(0o600);
  });

  it('is bounded, dropping the oldest first', async () => {
    const many = Array.from({ length: q.PENDING_LIMIT + 5 }, (_, i) => mem(String(i)));
    await q.stashExtractedMemories('c1', many);
    const items = await q.listPendingMemories();
    expect(items).toHaveLength(q.PENDING_LIMIT);
    expect(items[0].content).toBe('5');
  });

  it('ignores empty input and a missing conversation', async () => {
    expect(await q.stashExtractedMemories('c1', [])).toEqual([]);
    expect(await q.stashExtractedMemories('', [mem('x')])).toEqual([]);
    expect(await q.listPendingMemories()).toEqual([]);
  });

  it('skips malformed entries rather than failing the whole queue', async () => {
    await mkdir(dataDir.value, { recursive: true });
    const good = { id: 'g1', chatId: 'c1', createdAt: 1, content: 'ok', category: 'fact', tags: [], confidence: 0.5 };
    await writeFile(q.pendingMemoriesPath(), JSON.stringify({ items: [good, { id: 7 }, null, 'x'] }));
    expect(await q.listPendingMemories()).toEqual([good]);

    // And a stash rewrites it clean.
    await q.stashExtractedMemories('c2', [mem('new')]);
    const raw = JSON.parse(await readFile(q.pendingMemoriesPath(), 'utf-8'));
    expect(raw.items.map((i: { content: string }) => i.content)).toEqual(['ok', 'new']);
  });

  it('treats an unreadable file as an empty queue when reading', async () => {
    await writeFile(q.pendingMemoriesPath(), '{ not json');
    expect(await q.listPendingMemories()).toEqual([]);
  });
});

describe('waiting for extractions in flight', () => {
  it('resolves at once when nothing is in flight', async () => {
    const t = Date.now();
    await q.extractionsSettled(10_000);
    expect(Date.now() - t).toBeLessThan(1_000);
  });

  it('holds until every in-flight extraction has settled', async () => {
    const first = q.beginExtraction();
    const second = q.beginExtraction();
    let settled = false;
    const waiting = q.extractionsSettled(10_000).then(() => { settled = true; });

    first();
    first(); // idempotent: a double release must not count for the other one
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    second();
    await waiting;
    expect(settled).toBe(true);
  });

  it('gives up after the timeout', async () => {
    q.beginExtraction();
    const t = Date.now();
    await q.extractionsSettled(30);
    expect(Date.now() - t).toBeGreaterThanOrEqual(25);
  });

  it('stops waiting when the caller goes away', async () => {
    q.beginExtraction();
    const ctrl = new AbortController();
    const waiting = q.extractionsSettled(10_000, ctrl.signal);
    ctrl.abort();
    await waiting;
  });

  it('is shared across module instances, as Next loads one per route bundle', async () => {
    const release = q.beginExtraction();
    const other = await load();
    let settled = false;
    const waiting = other.extractionsSettled(10_000).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
    release();
    await waiting;
  });
});
