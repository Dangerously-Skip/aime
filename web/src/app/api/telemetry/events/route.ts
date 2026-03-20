import { NextRequest } from 'next/server';
import { queueEvent, flushBuffer } from '@/lib/telemetry/event-buffer';
import type { AnalyticsEvent } from '@/lib/telemetry/analytics-client';

export const runtime = 'nodejs';

/**
 * POST /api/telemetry/events
 * Accepts analytics events from the client and queues them in the server-side buffer.
 */
export async function POST(req: NextRequest) {
  let body: { events?: AnalyticsEvent[]; flush?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const events = body.events ?? [];
  for (const event of events) {
    queueEvent(event);
  }

  if (body.flush) {
    await flushBuffer();
  }

  return Response.json({ queued: events.length });
}
