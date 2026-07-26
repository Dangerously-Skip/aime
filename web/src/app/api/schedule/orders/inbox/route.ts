import { NextRequest } from 'next/server';
import { readInbox, ackInbox } from '@/lib/orders/manifest';

export const runtime = 'nodejs';

/**
 * The standing-order results inbox (C5b).
 *
 * GET            — entries awaiting replay (cards, notifications, bus posts).
 * POST { ids }   — acknowledge AFTER the renderer has applied them to its
 *                  stores. Ack-after-apply means a crash mid-replay redelivers
 *                  rather than drops — duplicated cards beat lost results.
 */

export async function GET() {
  return Response.json({ entries: await readInbox() });
}

export async function POST(req: NextRequest) {
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
    return Response.json({ error: 'ids must be an array of strings' }, { status: 400 });
  }
  const ok = await ackInbox(body.ids as string[]);
  return Response.json({ ok });
}
