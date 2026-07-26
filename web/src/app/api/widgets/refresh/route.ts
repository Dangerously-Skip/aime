import { NextRequest } from 'next/server';
import { refreshWidget } from '@/lib/widgets/refresh-service';
import type { Widget } from '@/lib/widgets/widget';

export const runtime = 'nodejs';

/**
 * Manual widget refresh (a tile's refresh button). Thin wrapper over
 * lib/widgets/refresh-service, which the server scheduler (P6/C5) also uses —
 * one code path, so manual and scheduled refreshes are indistinguishable in
 * the run log apart from their trigger.
 */
function isWidget(value: unknown): value is Widget {
  if (!value || typeof value !== 'object') return false;
  const w = value as Partial<Widget>;
  return typeof w.id === 'string' && typeof w.recipe === 'string' && w.recipe.trim().length > 0;
}

export async function POST(req: NextRequest) {
  let body: { widget?: Widget };
  try {
    body = (await req.json()) as { widget?: Widget };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isWidget(body.widget)) {
    return Response.json({ error: 'A widget with a recipe is required' }, { status: 400 });
  }

  const result = await refreshWidget(body.widget, 'manual');
  if (result.status !== 200) {
    return Response.json({ error: result.error, run: result.run }, { status: result.status });
  }
  return Response.json({ node: result.node, run: result.run });
}
