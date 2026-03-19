import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/cron — List cron jobs
 * POST /api/cron — Create a cron job
 * DELETE /api/cron — Delete a cron job by id
 *
 * Cron job state is managed client-side in cron-store.ts.
 * This route is a passthrough for server-side validation.
 */

export async function GET() {
  // State is stored client-side; this is a health-check endpoint
  return Response.json({ ok: true, message: 'Cron jobs are managed client-side via cron-store' });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      expression?: string;
      prompt?: string;
      surfaceId?: string;
    };

    const { expression, prompt, surfaceId } = body;

    if (!expression || !prompt || !surfaceId) {
      return Response.json({ error: 'expression, prompt, and surfaceId are required' }, { status: 400 });
    }

    // Validate cron expression (5 fields)
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return Response.json({ error: 'Invalid cron expression — must have 5 fields (min hour dom month dow)' }, { status: 400 });
    }

    return Response.json({ ok: true, expression, prompt, surfaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json() as { id?: string };
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    return Response.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
