'use client';

import { useState, useCallback } from 'react';
import { resolveSendRoute, type ModelOption } from '@/lib/models/client-options';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useBuiltinAccess } from '@/hooks/use-builtin-access';
import { refreshHarnessStatus } from '@/hooks/use-harness-status';

/**
 * Start a goal run from the ordinary composer.
 *
 * The route is resolved HERE, on the client, through `resolveSendRoute`. A
 * caller that lets the server pick resolves against the built-in Anthropic
 * registry and then demands an Anthropic key — dead for an OpenRouter-only user
 * while every other surface works, which the browser surface shipped for months.
 *
 * Planning and starting stay two calls because they fail differently: an
 * unusable plan is worth showing and retrying, and is not the same problem as a
 * run that will not start.
 */

/** A goal run does developer-shaped work, whichever surface started it. */
const CAPABILITY = 'code' as const;

export type StartPhase = 'idle' | 'planning' | 'starting';

/**
 * The `{model, providerConfig}` every harness request needs. No API key: the
 * server reads the one saved in Settings from its credential store, so the key
 * never has to live in (or leave) the browser.
 *
 * Extracted because it was built in exactly one place and the RESUME path — the
 * POST that restarts a loop after a parked question is answered — was written
 * without it. Those sessions ran with no credentials, failed instantly with
 * "Not logged in · Please run /login", and burned the task's attempts until the
 * stuck-task limit killed the run. Same defect as the routes had, one layer up,
 * for the third time.
 *
 * Anything that starts or resumes a run must use this.
 */
export function useHarnessRoute(modelRoute: ModelOption | null) {
  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);
  const { hasAnthropicKey, hasBedrock, known } = useBuiltinAccess();

  return useCallback(() => {
    const route = resolveSendRoute(modelRoute, providers, {
      capability: CAPABILITY,
      tierModels,
      hasAnthropicKey,
      hasBedrock,
      known,
    });
    /*
     * THE MODEL'S REAL PRICE, sent because only the client knows it.
     *
     * `pricingFor` searches the BUILT-IN Anthropic registry, so any BYOK model
     * falls back to Sonnet-tier rates — and on an OpenRouter-only setup that is
     * every model, which is why spend read high after the cache-token fix.
     *
     * The real numbers already exist: the OpenRouter scan reads each model's
     * prompt/completion price and stores it on the provider's models. They live
     * in the provider store, client-side, and `ProviderConfig` does not carry
     * them — so the server cannot look them up. It can be told.
     */
    const priced = providers
      .flatMap((p) => p.models ?? [])
      .find((m) => m.id === route?.model && m.pricing);

    return {
      model: route?.model ?? null,
      providerConfig: route?.providerConfig ?? null,
      modelPricing: priced?.pricing ?? null,
    };
  }, [modelRoute, providers, tierModels, hasAnthropicKey, hasBedrock, known]);
}

export function useStartGoal(surfaceId: 'cowork' | 'code', modelRoute: ModelOption | null) {
  const [phase, setPhase] = useState<StartPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  /*
   * The same route builder the resume path uses, so the two cannot diverge.
   * No BYOK key is sent: a user whose key lives only in Settings once hit
   * "Not logged in · Please run /login" here because nothing supplied it; the
   * provider now reads the saved key from the credential store itself.
   */
  const harnessRoute = useHarnessRoute(modelRoute);

  const start = useCallback(
    async (args: {
      conversationId: string;
      workingDir: string;
      objective: string;
      budgetUsd: number;
      sessionCap: number;
    }): Promise<boolean> => {
      setError(null);
      const common = {
        conversationId: args.conversationId,
        workingDir: args.workingDir,
        surfaceId,
        ...harnessRoute(),
      };

      setPhase('planning');
      try {
        const planned = await fetch('/api/harness/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...common,
            objective: args.objective,
            budgetUsd: args.budgetUsd,
            sessionCap: args.sessionCap,
          }),
        });
        if (!planned.ok) {
          const body = (await planned.json().catch(() => ({}))) as { error?: string };
          setPhase('idle');
          // The server's own words. "Something went wrong" would hide the one
          // thing that says whether to retry or rewrite the objective.
          setError(body.error ?? `Planning failed (${planned.status}).`);
          return false;
        }

        setPhase('starting');
        const started = await fetch('/api/harness', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(common),
        });
        if (!started.ok) {
          const body = (await started.json().catch(() => ({}))) as { error?: string };
          setPhase('idle');
          setError(body.error ?? `Could not start (${started.status}).`);
          return false;
        }
        setPhase('idle');
        // The shared status poll idles slowly while nothing runs; a run that
        // just started should show up now, and switch it to fast polling.
        void refreshHarnessStatus(args.conversationId, args.workingDir);
        return true;
      } catch (e) {
        setPhase('idle');
        setError(e instanceof Error ? e.message : 'Could not reach the server.');
        return false;
      }
    },
    [surfaceId, harnessRoute],
  );

  return { start, phase, error, setError };
}
