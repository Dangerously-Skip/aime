import { NextRequest } from 'next/server';
import {
  ackPendingMemories,
  extractionsSettled,
  listPendingMemories,
} from '@/lib/memory/pending-extractions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Memories the server extracted, waiting for the renderer to store them.
 *
 * GET    /api/memory/pending?wait=<ms>  → { items }
 * DELETE /api/memory/pending { ids }    → { removed }
 *
 * GET does NOT consume: the renderer stores what it got, then DELETEs those
 * ids. A crash between the two re-delivers instead of losing, and the renderer
 * keys each memory on its id, so re-delivery stores nothing new.
 *
 * `wait` lets the pull that follows a turn's `done` hold until that turn's
 * extraction (which starts only after the stream closes) has finished, rather
 * than finding the queue empty. Bounded here regardless of what is asked.
 */

/**
 * Above the chat route's 20s extraction budget, so a waiting pull sees it land.
 * Not exported: Next rejects unknown exports from a route module.
 */
const MAX_WAIT_MS = 30_000;
/** More than any single pull could need to acknowledge (the queue holds 500). */
const MAX_ACK_IDS = 1000;
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

function parseWait(raw: string | null): number | null {
  if (raw === null || raw === '') return 0;
  if (!/^\d{1,6}$/.test(raw)) return null;
  return Math.min(Number(raw), MAX_WAIT_MS);
}

export async function GET(req: NextRequest) {
  const wait = parseWait(req.nextUrl.searchParams.get('wait'));
  if (wait === null) {
    return Response.json({ error: 'wait must be a whole number of milliseconds' }, { status: 400 });
  }
  await extractionsSettled(wait, req.signal);
  const items = await listPendingMemories();
  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(req: NextRequest) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const ids = body?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_ACK_IDS ||
    !ids.every((id) => typeof id === 'string' && ID_PATTERN.test(id))
  ) {
    return Response.json({ error: 'ids must be a non-empty list of memory ids' }, { status: 400 });
  }
  try {
    const removed = await ackPendingMemories(ids as string[]);
    return Response.json({ removed });
  } catch (err) {
    console.error('[MEMORY] Failed to acknowledge pending memories:', err);
    return Response.json({ error: 'Could not update pending memories' }, { status: 500 });
  }
}
