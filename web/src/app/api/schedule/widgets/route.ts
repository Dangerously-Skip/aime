import { NextRequest } from 'next/server';
import { readManifest, writeManifest } from '@/lib/widgets/schedule-manifest';
import type { Widget } from '@/lib/widgets/widget';

export const runtime = 'nodejs';

/**
 * Widget schedule sync (P6/C5).
 *
 * PUT { widgets }  — the renderer mirrors its widget list here on every change;
 *                    this file is what the server scheduler executes from.
 * GET              — the renderer reads it back on launch/focus to merge renders
 *                    produced while the window was closed.
 *
 * The renderer is the source of truth for CRUD; the manifest is the source of
 * truth for "what happened while you were away". The merge rule lives client-
 * side: newer refreshedAt wins per widget.
 */

export async function GET() {
  return Response.json({ widgets: await readManifest() });
}

export async function PUT(req: NextRequest) {
  let body: { widgets?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.widgets)) {
    return Response.json({ error: 'widgets must be an array' }, { status: 400 });
  }

  /**
   * Merge before writing: the scheduler may have produced a render AFTER the
   * renderer last read it. A blind overwrite from a stale client would discard
   * that work — so per widget, the newer refreshedAt keeps its render.
   */
  const incoming = body.widgets as Widget[];
  const current = await readManifest();
  const byId = new Map(current.map((w) => [w.id, w]));
  const merged = incoming.map((w) => {
    const existing = byId.get(w.id);
    if (existing && (existing.refreshedAt ?? 0) > (w.refreshedAt ?? 0)) {
      return { ...w, render: existing.render, refreshedAt: existing.refreshedAt };
    }
    return w;
  });

  const ok = await writeManifest(merged);
  return Response.json({ ok, widgets: merged });
}
