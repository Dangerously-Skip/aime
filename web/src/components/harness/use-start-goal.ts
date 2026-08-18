'use client';

import { useState, useCallback } from 'react';
import { resolveSendRoute, type ModelOption } from '@/lib/models/client-options';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useBuiltinAccess } from '@/hooks/use-builtin-access';

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

export function useStartGoal(surfaceId: 'cowork' | 'code', modelRoute: ModelOption | null) {
  const [phase, setPhase] = useState<StartPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const tierModels = useSettingsStore((s) => s.tierModels);
  const providers = useProviderStore((s) => s.providers);
  const { hasAnthropicKey, hasBedrock, known } = useBuiltinAccess();

  const start = useCallback(
    async (args: {
      conversationId: string;
      workingDir: string;
      objective: string;
      budgetUsd: number;
      sessionCap: number;
    }): Promise<boolean> => {
      setError(null);
      const route = resolveSendRoute(modelRoute, providers, {
        capability: CAPABILITY,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
        known,
      });

      const common = {
        conversationId: args.conversationId,
        workingDir: args.workingDir,
        surfaceId,
        model: route?.model ?? null,
        providerConfig: route?.providerConfig ?? null,
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
        return true;
      } catch (e) {
        setPhase('idle');
        setError(e instanceof Error ? e.message : 'Could not reach the server.');
        return false;
      }
    },
    [surfaceId, modelRoute, providers, tierModels, hasAnthropicKey, hasBedrock, known],
  );

  return { start, phase, error, setError };
}
