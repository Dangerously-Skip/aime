/**
 * Widget refresh — the core, shared by the API route (manual refresh from a
 * tile) and the server scheduler (P6/C5, refresh with the window closed).
 * Everything here is server-side: model call, validation, run recording.
 */
import { widgetSystemPrompt, extractWidgetJson } from './prompt';
import { parseWidget, type WidgetNode } from './catalog';
import { isGrounded, WIDGET_REFRESH_TIMEOUT_MS, widgetToGoal, type Widget } from './widget';
import { startRun, finishRun } from '@/lib/runs/runs';
import { appendRun } from '@/lib/runs/run-log';
import type { Run, RunTrigger } from '@/lib/runs/types';

export interface RefreshResult {
  node: WidgetNode | null;
  run: Run;
  error?: string;
  /** HTTP-ish status for the route wrapper. */
  status: 200 | 502 | 504;
}

/**
 * Re-run a widget's recipe and validate the result. Always records a Run —
 * a reply that can't become a tile is a FAILED run, not a silent no-op, so a
 * widget that never renders can't look idle.
 */
export async function refreshWidget(widget: Widget, trigger: RunTrigger = 'manual'): Promise<RefreshResult> {
  const goal = widgetToGoal(widget);

  let run: Run = startRun({
    id: globalThis.crypto.randomUUID(),
    now: Date.now(),
    goalId: goal.id,
    trigger,
    surfaceId: 'assistant',
  });

  const settle = async (
    status: 'succeeded' | 'failed' | 'timeout',
    extra: { error?: string; node?: unknown },
  ) => {
    run = finishRun(run, {
      now: Date.now(),
      status,
      error: extra.error,
      deliverables: extra.node ? [{ kind: 'widget', title: widget.title, data: extra.node }] : [],
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
      return { node: null, run: finished, error: finished.error, status: 504 };
    }

    const node = parseWidget(extractWidgetJson(text));
    if (!node) {
      const finished = await settle('failed', {
        error: "The refresh didn't produce a renderable widget — try a more specific recipe",
      });
      return { node: null, run: finished, error: finished.error, status: 502 };
    }

    const finished = await settle('succeeded', { node });
    return { node, run: finished, status: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    const finished = await settle('failed', { error: message });
    return { node: null, run: finished, error: message, status: 502 };
  }
}
