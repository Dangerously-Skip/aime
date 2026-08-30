'use client';

import { useEffect, useRef } from 'react';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useBuiltinAccess } from '@/hooks/use-builtin-access';
import { resolveSendRoute } from '@/lib/models/client-options';
import { SURFACE_ROUTES } from '@/lib/models/surface-routes';

/**
 * Publish the tier grid's decision to the server, whenever it changes.
 *
 * WHY THIS EXISTS. Scheduled work runs inside the Next server with no request —
 * the widget scheduler ticks every 60s so a refresh works "with no window at
 * all" — and so it cannot see the provider store or the tier grid. Left to
 * itself it fell back to a hardcoded `'haiku'` and an Anthropic-only key, which
 * on any other account is not a degraded refresh but no refresh at all, once per
 * tick, silently.
 *
 * WHAT IS PUBLISHED. `resolveSendRoute`'s OUTPUT, for the capability/tier pairs
 * the surfaces actually ask for. Not a second way of choosing a model — that
 * function stays the only one — a persisted copy of what it decided, so a
 * process that cannot run it can still obey it.
 *
 * WHY IT IS DRIVEN BY AN EFFECT AND NOT A SAVE BUTTON. The decision changes for
 * reasons other than a settings edit: a provider is scanned, a credential lands,
 * built-in access resolves. Watching the inputs is the only way the copy cannot
 * lag behind the original.
 */

/**
 * The capabilities worth publishing: whatever a surface can ask for.
 *
 * Derived from `SURFACE_ROUTES` rather than listed, so a new surface's
 * capability is published without anyone remembering to come back here.
 */
function slots(): string[] {
  return [...new Set(Object.values(SURFACE_ROUTES).map((r) => r.capability))];
}

export function useExecutionManifest(): void {
  const providers = useProviderStore((s) => s.providers);
  const tierModels = useSettingsStore((s) => s.tierModels);
  const { hasAnthropicKey, hasBedrock, known } = useBuiltinAccess();

  /*
   * The last payload we sent. Publishing is idempotent but not free, and the
   * inputs here re-render for reasons that do not change the decision — a
   * provider's `lastScannedAt`, say. Comparing the RESULT is what makes this
   * quiet; comparing the inputs would not.
   */
  const lastSent = useRef<string>('');

  useEffect(() => {
    // Until built-in access resolves, every route would resolve as if the user
    // had no Anthropic key — publishing that would be publishing a wrong answer.
    if (!known) return;

    const routes = slots().map((capability) => {
      const route = resolveSendRoute(null, providers, {
        capability: capability as never,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
        known,
      });
      return { capability, model: route?.model ?? null, providerConfig: route?.providerConfig };
    });

    const payload = JSON.stringify({ routes });
    if (payload === lastSent.current) return;

    // Nothing resolvable yet — mid-hydration, or no providers. The route refuses
    // an empty manifest rather than erasing a good one, but not sending is
    // cheaper and says the same thing.
    if (routes.every((r) => !r.model)) return;

    lastSent.current = payload;
    void fetch('/api/models/execution-manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
      .then(async (res) => {
        /*
         * A 200 IS NOT NECESSARILY A SAVE. The route answers 200 with
         * `{ ok: false, skipped }` when nothing resolvable survived parsing —
         * deliberately, so a mid-hydration client cannot erase a good manifest.
         *
         * But `.catch` never fires for a 200, so a route that discarded
         * everything looked identical to one that saved. That is how this sat
         * unnoticed: the publisher published, the server dropped every entry,
         * both sides believed it had worked, and the manifest was never
         * written at all.
         *
         * We only reach here having already refused to send an all-null set, so
         * a total discard is a real failure. Forgetting `lastSent` makes the
         * next settings change retry instead of deduplicating against a payload
         * that never landed.
         */
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!res.ok || body?.ok === false) {
          lastSent.current = '';
          console.warn(
            '[AIME] The execution manifest was not saved, so scheduled work and widget ' +
              'refreshes have no model. It will retry on the next settings change.',
          );
        }
      })
      .catch(() => {
        // Publishing is best-effort: a failure means scheduled work keeps the
        // PREVIOUS manifest, which is the right fallback. Retry on the next
        // change rather than looping here.
        lastSent.current = '';
      });
  }, [providers, tierModels, hasAnthropicKey, hasBedrock, known]);
}
