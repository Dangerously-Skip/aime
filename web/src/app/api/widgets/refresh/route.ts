import { NextRequest } from 'next/server';
import { widgetSystemPrompt, extractWidgetJson } from '@/lib/widgets/prompt';
import { parseWidget } from '@/lib/widgets/catalog';
import { isGrounded, widgetToGoal, WIDGET_REFRESH_TIMEOUT_MS, type Widget } from '@/lib/widgets/widget';
import { startRun, finishRun } from '@/lib/runs/runs';
import { appendRun } from '@/lib/runs/run-log';
import type { Run } from '@/lib/runs/types';

export const runtime = 'nodejs';

/**
 * Refresh a widget: re-run its recipe and return a validated node.
 *
 * POST /api/widgets/refresh { widget } → { node, run }
 *
 * The refresh is an ordinary Run against the Goal the widget already is, so it
 * lands in the same durable log with the same cost attribution as every other
 * execution — which is exactly what gives tiles run history and failure streaks.
 *
 * Hard-bounded: cheap tier, one shot, 180s ceiling. A dashboard tile is not
 * worth an unbounded agent run.
 */

interface Body {
  widget?: Widget;
}

function isWidget(value: unknown): value is Widget {
  if (!value || typeof value !== 'object') return false;
  const w = value as Partial<Widget>;
  return typeof w.id === 'string' && typeof w.recipe === 'string' && w.recipe.trim().length > 0;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isWidget(body.widget)) {
    return Response.json({ error: 'A widget with a recipe is required' }, { status: 400 });
  }
  const widget = body.widget;
  const goal = widgetToGoal(widget);

  const now = Date.now();
  let run: Run = startRun({
    id: globalThis.crypto.randomUUID(),
    now,
    goalId: goal.id,
    trigger: 'manual',
    surfaceId: 'assistant',
  });

  /** Record the outcome, then answer. Recording must never fail the request. */
  const settle = async (
    status: 'succeeded' | 'failed' | 'timeout',
    extra: { error?: string; node?: unknown },
  ) => {
    run = finishRun(run, {
      now: Date.now(),
      status,
      error: extra.error,
      deliverables: extra.node
        ? [{ kind: 'widget', title: widget.title, data: extra.node }]
        : [],
    });
    await appendRun(run).catch(() => false);
    return run;
  };

  const grounded = isGrounded(widget);
  const system = widgetSystemPrompt({
    grounded,
    webUnconfigured: !process.env.SEARXNG_INSTANCES,
  });

  try {
    const { getProvider } = await import('@/lib/providers');
    const provider = getProvider('claude');

    // One-shot: collect text, then extract. No streaming to the client — a
    // refresh returns a finished tile or nothing.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WIDGET_REFRESH_TIMEOUT_MS);
    let text = '';
    let timedOut = false;

    try {
      for await (const chunk of provider.query({
        prompt: widget.recipe,
        chatId: `widget-${widget.id}`,
        surfaceId: 'assistant',
        systemPrompt: system,
        // Pinned cheap: short structured generation, not reasoning work.
        model: 'haiku',
        maxTurns: grounded ? 6 : 1,
      })) {
        if (chunk.type === 'text') text += (chunk.content as string) ?? '';
      }
    } catch (err) {
      if (controller.signal.aborted) timedOut = true;
      else throw err;
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) {
      const finished = await settle('timeout', { error: 'The refresh exceeded its time budget' });
      return Response.json({ error: finished.error, run: finished }, { status: 504 });
    }

    const node = parseWidget(extractWidgetJson(text));
    if (!node) {
      // A model reply we can't turn into a valid tile is a failed run, not a
      // silent no-op — otherwise a widget that never renders looks idle.
      const finished = await settle('failed', {
        error: "The refresh didn't produce a renderable widget — try a more specific recipe",
      });
      return Response.json({ error: finished.error, run: finished }, { status: 502 });
    }

    const finished = await settle('succeeded', { node });
    return Response.json({ node, run: finished });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    const finished = await settle('failed', { error: message });
    return Response.json({ error: message, run: finished }, { status: 502 });
  }
}
