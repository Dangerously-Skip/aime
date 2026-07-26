import { NextRequest } from 'next/server';
import { readOrderManifest, writeOrderManifest, mergeOrders, type ManifestOrder } from '@/lib/orders/manifest';

export const runtime = 'nodejs';

/**
 * Standing-order schedule sync (C5b).
 *
 * PUT { orders } — the renderer mirrors its orders; the merge keeps
 * server-owned execution results (lastRun, runCount, state, errors, terminal
 * status) when the server ran more recently, so a stale client can't erase
 * work done while it was closed — or worse, flip a completed order back to
 * active and re-execute it.
 * GET — the merged manifest back, for launch-time reconciliation.
 */

export async function GET() {
  return Response.json({ orders: await readOrderManifest() });
}

export async function PUT(req: NextRequest) {
  let body: { orders?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.orders)) {
    return Response.json({ error: 'orders must be an array' }, { status: 400 });
  }

  const merged = mergeOrders(body.orders as ManifestOrder[], await readOrderManifest());
  const ok = await writeOrderManifest(merged);
  return Response.json({ ok, orders: merged });
}
