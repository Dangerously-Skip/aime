import { NextRequest } from 'next/server';
import { queueEvent, flushBuffer } from '@/lib/telemetry/event-buffer';
import { isTelemetryEnabled, type AnalyticsEvent } from '@/lib/telemetry/analytics-client';

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

  // Telemetry is off without ANALYTICS_API_URL: nothing is queued, and
  // `enabled: false` tells the client to stop posting.
  const enabled = isTelemetryEnabled();
  const events = enabled && Array.isArray(body.events) ? body.events : [];
  for (const event of events) {
    queueEvent(event);
  }

  if (enabled && body.flush) {
    await flushBuffer();
  }

  return Response.json({ queued: events.length, enabled });
}
