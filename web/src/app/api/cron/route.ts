import { NextRequest } from 'next/server';
import { validateCron, describeCron } from '@/lib/schedule/cron';

export const runtime = 'nodejs';

/**
 * GET /api/cron — health check
 * POST /api/cron — validate a cron job before it is saved
 * DELETE /api/cron — acknowledge a deletion by id
 *
 * Jobs themselves live in the order manifest (`lib/schedule/write`); this route
 * is the server-side validation a creation path asks before writing one.
 */

export async function GET() {
  return Response.json({ ok: true, message: 'Scheduled jobs live in the order manifest' });
}

export async function POST(req: NextRequest) {
  let body: { expression?: unknown; prompt?: unknown; surfaceId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const { expression, prompt, surfaceId } = body;
  if (typeof expression !== 'string' || !expression.trim() || typeof prompt !== 'string' || !prompt.trim()
    || typeof surfaceId !== 'string' || !surfaceId.trim()) {
    return Response.json({ error: 'expression, prompt, and surfaceId are required' }, { status: 400 });
  }

  /*
   * A REAL PARSE, not a field count. Counting to five accepted `0 9 * * MON-FRI`
   * (which the old matcher could never match) and `60 * * * *` (no such minute),
   * so the job was saved, listed, and silently never ran.
   */
  const error = validateCron(expression);
  if (error) {
    return Response.json({ error: `Invalid cron expression — ${error}` }, { status: 400 });
  }

  return Response.json({
    ok: true,
    expression: expression.trim(),
    prompt,
    surfaceId,
    description: describeCron(expression),
  });
}

export async function DELETE(req: NextRequest) {
  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  if (typeof body.id !== 'string' || !body.id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }
  return Response.json({ ok: true, id: body.id });
}
