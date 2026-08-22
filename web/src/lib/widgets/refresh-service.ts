/**
 * Widget refresh — the core, shared by the API route (manual refresh from a
 * tile) and the server scheduler (P6/C5, refresh with the window closed).
 * Everything here is server-side: model call, validation, run recording.
 */
import { widgetSystemPrompt, extractWidgetJson } from './prompt';
import { parseWidget, type WidgetNode } from './catalog';
import { isGrounded, WIDGET_REFRESH_TIMEOUT_MS, widgetToGoal, type Widget } from './widget';
import { readExecutionManifest } from '@/lib/models/execution-manifest-fs';
import { resolveFromManifest } from '@/lib/models/execution-manifest';
import { getSurfaceRoute } from '@/lib/models/surface-routes';

/**
 * A widget refresh runs as the Assistant surface, so it asks for that surface's
 * capability. Derived rather than typed out, so it follows if that changes.
 */
const WIDGET_CAPABILITY = getSurfaceRoute('assistant').capability;
import { startRun, finishRun } from '@/lib/runs/runs';
import { hasSearch } from '@/lib/search/resolve';
import { appendRun } from '@/lib/runs/run-log';
import type { Run, RunTrigger } from '@/lib/runs/types';

export interface RefreshResult {
  node: WidgetNode | null;
  run: Run;
  error?: string;
  /** HTTP-ish status for the route wrapper. */
  status: 200 | 502 | 504;
}

export interface RefreshOpts {
  /** Model override for retry escalation (default: haiku — cheap tier). */
  model?: string;
}



/**
 * Re-run a widget's recipe and validate the result. Always records a Run —
 * a reply that can't become a tile is a FAILED run, not a silent no-op, so a
 * widget that never renders can't look idle.
 */
export async function refreshWidget(
  widget: Widget,
  trigger: RunTrigger = 'manual',
  opts: RefreshOpts = {},
): Promise<RefreshResult> {
  const goal = widgetToGoal(widget);

  /*
   * THE MODEL THE USER ACTUALLY CONFIGURED, or none.
   *
   * This read `opts.model ?? 'haiku'`, with credentials from
   * `getServerAnthropicKey()` — so on an account with no Anthropic key every
   * scheduled refresh failed, once per tick, invisibly. Third instance of that
   * bug this week; the memory extractor and the search carrier were the others.
   *
   * The scheduler has no request to carry the user's configuration, so it reads
   * the manifest the renderer publishes — `resolveSendRoute`'s own output, not a
   * second way of choosing. Resolved here rather than defaulted: a guess is what
   * the previous line was.
   */
  const manifest = await readExecutionManifest();
  const route = resolveFromManifest(manifest, WIDGET_CAPABILITY);
  const model = opts.model ?? route?.model ?? null;

  /*
   * NO MODEL, NO REFRESH — and say so out loud.
   *
   * The alternative is the line this replaced: guess a vendor's model id, send
   * it to whatever provider the user actually has, and collect a 400 per tick
   * that nobody ever sees. A refresh that declines is a visible gap the user can
   * act on; a refresh that fails silently is indistinguishable from one that
   * never ran, which is how this survived.
   *
   * `run` is still recorded, so the gap appears in the run history rather than
   * only in a log.
   */
  if (!model) {
    const skipped = finishRun(
      startRun({
        id: globalThis.crypto.randomUUID(),
        now: Date.now(),
        goalId: goal.id,
        trigger,
        surfaceId: 'assistant',
        model: 'unresolved',
      }),
      {
        now: Date.now(),
        status: 'failed',
        error:
          'No model is configured for this capability. Open Settings and choose one in the tier ' +
          'grid — scheduled refreshes use the same models the surfaces do.',
        deliverables: [],
      },
    );
    await appendRun(skipped).catch(() => false);
    return { node: null, run: skipped, error: skipped.error, status: 502 };
  }

  let run: Run = startRun({
    id: globalThis.crypto.randomUUID(),
    now: Date.now(),
    goalId: goal.id,
    trigger,
    surfaceId: 'assistant',
    model,
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
    webUnconfigured: !hasSearch(null, process.env),
  });

  try {
    const { getProvider } = await import('@/lib/providers');
    const provider = getProvider('claude');
    /*
     * The configured provider's credential, falling back to the built-in
     * Anthropic key only when the manifest names no provider — that is the
     * first-party case, where the built-in key IS the configuration.
     */
    /*
     * The SAME resolver the harness route uses, rather than a second way of
     * turning a provider config into execution parameters. It handles the key
     * lookup, the base URL, and the env that Bedrock and Vertex need instead of
     * a key — none of which a hand-rolled version here would have got right.
     */
    const { resolveHarnessExecution } = await import('@/lib/harness/execution');
    /*
     * OUR OWN ORIGIN, because there is no request to take it from.
     *
     * `shimOrigin` is what routes a BYOK provider's traffic through this app's
     * llm-proxy instead of handing the key to the Agent SDK's subprocess. Main
     * sets PORT and HOSTNAME on the server process, so the origin is knowable
     * without a request.
     *
     * If PORT is somehow absent, the empty string means "no shim" and
     * `resolveExecution` uses the provider's real base URL directly — which
     * still works. Degrading to the less isolated path beats declining to run.
     */
    const shimOrigin = process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : '';
    const exec = await resolveHarnessExecution(
      { model, providerConfig: route?.providerConfig },
      model,
      shimOrigin,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WIDGET_REFRESH_TIMEOUT_MS);
    let text = '';
    let timedOut = false;

    try {
      for await (const chunk of provider.query({
        baseUrl: exec.baseUrl,
        providerEnv: exec.providerEnv,
        prompt: widget.recipe,
        chatId: `widget-${widget.id}`,
        surfaceId: 'assistant',
        systemPrompt: system,
        // Cheap by default (short structured generation); the scheduler may
        // escalate the model on retry when a cheap attempt couldn't produce a
        // renderable node — that is a capability failure, not a transient one.
        model: exec.model,
        apiKey: exec.apiKey,
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
