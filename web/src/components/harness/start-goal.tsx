'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resolveSendRoute } from '@/lib/models/client-options'
import { useProviderStore } from '@/stores/provider-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { ModelOption } from '@/lib/models/client-options'
import { useBuiltinAccess } from '@/hooks/use-builtin-access'

/**
 * Start a long-running goal run.
 *
 * WHY THE ROUTE IS RESOLVED HERE. The server must not pick its own model. A
 * caller that resolves its own resolves against the BUILT-IN Anthropic registry
 * and then demands an Anthropic key, so for an OpenRouter-only user the feature
 * is dead while every other surface works — the defect the browser surface
 * shipped for months, and which the harness routes had quietly reintroduced
 * until a real run failed with "Not logged in · Please run /login".
 *
 * So this resolves through `resolveSendRoute`, the one chokepoint, exactly the
 * way the other surfaces do, and sends `{model, providerConfig}` with the
 * request. Planning and running are two calls because they fail differently: an
 * unusable plan is worth seeing and retrying, and is not the same problem as a
 * run that will not start.
 */

/** A goal run does developer-shaped work, whichever surface it was started from. */
const CAPABILITY = 'code' as const;

/**
 * A default the user can change before starting, not a hidden one.
 *
 * Low on purpose. A goal run is the one thing in this app that spends money
 * without someone watching, and the failure the literature keeps recording is an
 * agent retrying into a wall for hours — $4,200 in one case, with three
 * dashboards displaying the spend and none of them able to stop it. A ceiling
 * you notice is worth more than a ceiling that is generous.
 */
export const DEFAULT_BUDGET_USD = 2;
export const DEFAULT_SESSION_CAP = 12;

export function StartGoal({
  conversationId,
  workingDir,
  surfaceId,
  modelRoute = null,
  onStarted,
}: {
  conversationId: string
  workingDir: string
  surfaceId: 'cowork' | 'code'
  /**
   * The surface's own pinned model, if it has one.
   *
   * A prop rather than a store read, because `modelRoute` is per-surface state
   * and this component is mounted in two of them. `null` is the normal case and
   * means UNPINNED — `resolveSendRoute` then answers from the tier grid, which
   * is what "follow Settings" means.
   */
  modelRoute?: ModelOption | null
  onStarted?: () => void
}) {
  const [objective, setObjective] = useState('')
  const [budget, setBudget] = useState(String(DEFAULT_BUDGET_USD))
  const [cap, setCap] = useState(String(DEFAULT_SESSION_CAP))
  const [phase, setPhase] = useState<'idle' | 'planning' | 'starting'>('idle')
  const [error, setError] = useState<string | null>(null)

  const tierModels = useSettingsStore((s) => s.tierModels)
  const providers = useProviderStore((s) => s.providers)
  const { hasAnthropicKey, hasBedrock, known } = useBuiltinAccess()

  const start = async () => {
    setError(null)
    const route = resolveSendRoute(modelRoute, providers, {
      capability: CAPABILITY,
      tierModels,
      hasAnthropicKey,
      hasBedrock,
      known,
    })

    const budgetUsd = Number(budget)
    const sessionCap = Number(cap)
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return setError('Give it a budget above zero.')
    if (!Number.isInteger(sessionCap) || sessionCap <= 0) return setError('Sessions must be a whole number.')

    const common = {
      conversationId,
      workingDir,
      surfaceId,
      model: route?.model ?? null,
      providerConfig: route?.providerConfig ?? null,
    }

    setPhase('planning')
    try {
      const planned = await fetch('/api/harness/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...common, objective, budgetUsd, sessionCap }),
      })
      if (!planned.ok) {
        const body = (await planned.json().catch(() => ({}))) as { error?: string }
        // The planner's own words. "Something went wrong" would hide the one
        // thing that tells the user whether to retry or rewrite the objective.
        setPhase('idle')
        return setError(body.error ?? `Planning failed (${planned.status}).`)
      }

      setPhase('starting')
      const started = await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(common),
      })
      if (!started.ok) {
        const body = (await started.json().catch(() => ({}))) as { error?: string }
        setPhase('idle')
        return setError(body.error ?? `Could not start (${started.status}).`)
      }
      setPhase('idle')
      onStarted?.()
    } catch (e) {
      setPhase('idle')
      setError(e instanceof Error ? e.message : 'Could not reach the server.')
    }
  }

  const busy = phase !== 'idle'

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-3">
      <div>
        <h4 className="text-sm font-medium">Pursue a goal</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Runs on its own across many sessions, checking its own work, and stops when it is done or
          needs you.
        </p>
      </div>

      <textarea
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder="What should be true when this is finished?"
        rows={3}
        disabled={busy}
        className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-xs outline-none focus:border-primary/50 disabled:opacity-60"
      />

      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          Budget $
          <Input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={busy}
            inputMode="decimal"
            className="h-7 text-xs"
          />
        </label>
        <label className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          Sessions
          <Input
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            disabled={busy}
            inputMode="numeric"
            className="h-7 text-xs"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-xs">
          {error}
        </p>
      )}

      <Button size="sm" className="w-full" onClick={start} disabled={busy || !objective.trim()}>
        {phase === 'planning' ? 'Planning…' : phase === 'starting' ? 'Starting…' : 'Plan and start'}
      </Button>
    </div>
  )
}
