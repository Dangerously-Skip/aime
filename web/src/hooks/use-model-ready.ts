'use client';

import { useMemo } from 'react';
import { resolveSendRoute, type ModelOption } from '@/lib/models/client-options';
import type { ClientRoute } from '@/lib/models/effective-registry';
import type { Capability } from '@/lib/models/types';
import { useBuiltinAccess } from '@/hooks/use-builtin-access';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * Can a turn sent now reach any model at all?
 *
 * A built-in route needs an Anthropic key (the user's or the server's) or
 * Bedrock; without either, only a route onto a user provider — one that carries
 * `providerConfig` — can answer. Unknown reachability (the server has not said
 * yet) counts as ready: blocking a send on a question still in flight would
 * refuse users who are perfectly set up.
 */
export function hasUsableModel(
  route: ClientRoute | null,
  access: { known: boolean; hasAnthropicKey: boolean; hasBedrock: boolean },
): boolean {
  if (!access.known) return true;
  if (access.hasAnthropicKey || access.hasBedrock) return true;
  return !!route?.providerConfig;
}

/**
 * The cheap client-side answer to "is a model configured?", resolved through
 * the same `resolveSendRoute` the send path uses, so the two cannot disagree.
 * Used to show "Connect a model" INSTEAD of sending a turn that can only fail.
 */
export function useModelReady(selection: ModelOption | null, capability: Capability): boolean {
  const access = useBuiltinAccess();
  const providers = useProviderStore((s) => s.providers);
  const tierModels = useSettingsStore((s) => s.tierModels);
  return useMemo(
    () =>
      hasUsableModel(
        resolveSendRoute(selection, providers, {
          capability,
          tierModels,
          hasAnthropicKey: access.hasAnthropicKey,
          hasBedrock: access.hasBedrock,
          known: access.known,
        }),
        access,
      ),
    [selection, providers, capability, tierModels, access],
  );
}
