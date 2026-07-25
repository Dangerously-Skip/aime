'use client'

/**
 * "How AIME picks models" — the tier grid.
 *
 * A tier is a promise about cost and capability. Rather than asking the user to
 * label the ~345 models an OpenRouter scan returns, we ask four questions: which
 * model fills each tier slot. Each slot is pre-filled by output-price inference
 * (`inferTier`) and is overridable.
 *
 * The per-slot picker spans the FULL catalog, so it is search-backed and renders
 * at most MAX_VISIBLE matches at a time — a plain dropdown over 345 models
 * spanning a 20,000x price range is unusable. Rendering is inline (no portal) so
 * the bound stays observable in tests.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useProviderStore } from '@/stores/provider-store'
import { TIER_ORDER, type Tier } from '@/lib/models/types'
import {
  BUILTIN_GROUP,
  TIER_LABELS,
  buildTierSlotCandidates,
  type BuiltinModel,
} from '@/lib/models/client-options'
import { inferTier } from '@/lib/models/effective-registry'
import { SURFACE_ROUTES, getSurfaceRoute } from '@/lib/models/surface-routes'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Layers, Search, X } from 'lucide-react'

/** Never render more than this many candidates at once (catalogs hit ~345). */
const MAX_VISIBLE = 30

/**
 * The built-ins, mirroring the send-time picker. Duplicated deliberately rather
 * than imported from `model-selector.tsx` — the list is presentation, and the
 * two surfaces are free to diverge.
 */
const BUILTINS: BuiltinModel[] = [
  { id: 'opus', label: 'Opus 4.7' },
  { id: 'sonnet', label: 'Sonnet 4.6' },
  { id: 'haiku', label: 'Haiku 4.5' },
]

/**
 * Output USD per 1k tokens for the built-ins. These are the anchors the tier
 * price bands were drawn around (haiku → cheap, sonnet → good, opus → smort),
 * so pre-fill lands a Claude model in three of the four slots out of the box.
 */
const BUILTIN_OUTPUT_PER_1K: Record<string, number> = {
  opus: 0.025,
  sonnet: 0.015,
  haiku: 0.005,
}

interface Candidate {
  id: string
  label: string
  group: string
  outputPer1kUsd?: number
}

function formatPrice(outputPer1kUsd?: number): string | null {
  if (outputPer1kUsd == null || !Number.isFinite(outputPer1kUsd)) return null
  return `$${outputPer1kUsd.toFixed(4)}/1k out`
}

function tierOf(candidate: Candidate): Tier | null {
  const out = candidate.outputPer1kUsd
  if (out == null) return null
  return inferTier({ inputPer1kUsd: out, outputPer1kUsd: out })
}

/**
 * The pre-fill for a tier: the cheapest candidate whose inferred tier matches,
 * preferring a built-in so a fresh install shows Claude rather than whichever
 * scanned model happens to be cheapest in the band.
 */
function inferredForTier(tier: Tier, candidates: Candidate[]): Candidate | null {
  const matches = candidates.filter((c) => tierOf(c) === tier)
  if (matches.length === 0) return null
  const cheapest = (list: Candidate[]) =>
    [...list].sort((a, b) => (a.outputPer1kUsd ?? Infinity) - (b.outputPer1kUsd ?? Infinity))[0]
  const builtins = matches.filter((c) => c.group === BUILTIN_GROUP)
  return builtins.length > 0 ? cheapest(builtins) : cheapest(matches)
}

function filterCandidates(candidates: Candidate[], query: string): Candidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return candidates
  return candidates.filter((c) =>
    `${c.label} ${c.id} ${c.group}`.toLowerCase().includes(q),
  )
}

/** "Stallion — top coding" → name + descriptor, for two-tone rendering. */
function splitTierLabel(tier: Tier): { name: string; descriptor: string } {
  const [name, ...rest] = TIER_LABELS[tier].split('—')
  return { name: name.trim(), descriptor: rest.join('—').trim() }
}

export function TierGrid() {
  const providers = useProviderStore((s) => s.providers)
  const tierModels = useSettingsStore((s) => s.tierModels)
  const setTierModel = useSettingsStore((s) => s.setTierModel)
  const surfaceTiers = useSettingsStore((s) => s.surfaceTiers)
  const setSurfaceTier = useSettingsStore((s) => s.setSurfaceTier)

  // provider-store hydrates lazily (skipHydration).
  useEffect(() => {
    void useProviderStore.persist.rehydrate()
  }, [])

  const [openTier, setOpenTier] = useState<Tier | null>(null)
  const [query, setQuery] = useState('')

  const candidates = useMemo<Candidate[]>(
    () =>
      buildTierSlotCandidates(BUILTINS, providers).map((c) => ({
        ...c,
        outputPer1kUsd: c.outputPer1kUsd ?? BUILTIN_OUTPUT_PER_1K[c.id],
      })),
    [providers],
  )

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])

  const inferred = useMemo(() => {
    const out: Partial<Record<Tier, Candidate>> = {}
    for (const tier of TIER_ORDER) {
      const pick = inferredForTier(tier, candidates)
      if (pick) out[tier] = pick
    }
    return out
  }, [candidates])

  const matches = useMemo(() => filterCandidates(candidates, query), [candidates, query])
  const visible = matches.slice(0, MAX_VISIBLE)

  function togglePicker(tier: Tier) {
    setQuery('')
    setOpenTier((cur) => (cur === tier ? null : tier))
  }

  function assign(tier: Tier, modelId: string) {
    setTierModel(tier, modelId)
    setOpenTier(null)
    setQuery('')
  }

  return (
    <div className="border rounded-lg p-6 bg-card space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-medium">How AIME picks models</h4>
      </div>
      <p className="text-sm text-muted-foreground">
        A tier is a promise about cost and capability. Pick which model fills each — or leave it
        on the inferred default.
      </p>

      <div className="space-y-2">
        {TIER_ORDER.map((tier) => {
          const { name, descriptor } = splitTierLabel(tier)
          const assignedId = tierModels[tier]
          const assigned = assignedId ? byId.get(assignedId) : undefined
          const fallback = inferred[tier]
          const shown = assignedId ? assigned : fallback
          const price = formatPrice(shown?.outputPer1kUsd)
          const isOpen = openTier === tier

          return (
            <div
              key={tier}
              data-testid="tier-row"
              className="rounded-lg border border-border/70 p-3.5 space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium capitalize">{name}</span>
                <span className="text-xs text-muted-foreground">{descriptor}</span>

                <div className="ml-auto flex items-center gap-2">
                  {assignedId ? (
                    <span className="text-xs font-medium" title={assignedId}>
                      {assigned?.label ?? assignedId}
                    </span>
                  ) : fallback ? (
                    <span className="text-xs text-muted-foreground/70">
                      {fallback.label}{' '}
                      <span className="text-[10px] uppercase tracking-wide">inferred</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70 italic">
                      nothing inferred — pick a model
                    </span>
                  )}
                  {price && (
                    <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                      {price}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    aria-expanded={isOpen}
                    onClick={() => togglePicker(tier)}
                  >
                    <Search className="h-3.5 w-3.5 mr-1" />
                    {isOpen ? 'Close' : 'Change'}
                  </Button>
                  {assignedId && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 hover:text-destructive"
                      title={`Clear ${name} assignment`}
                      onClick={() => setTierModel(tier, null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="rounded-lg border border-border/70 bg-background/40 p-3 space-y-2">
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models…"
                    aria-label={`Search models for ${name}`}
                    className="h-8 text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {matches.length === 0
                      ? 'No models match.'
                      : `showing ${visible.length} of ${matches.length}`}
                  </p>
                  <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
                    {visible.map((c) => (
                      <button
                        key={c.id}
                        data-testid="tier-option"
                        onClick={() => assign(tier, c.id)}
                        className="flex w-full items-center gap-2 px-1.5 py-1.5 text-left hover:bg-accent/40"
                      >
                        <span className="text-xs truncate">{c.label}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                          {c.group}
                        </span>
                        <span className="ml-auto text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">
                          {formatPrice(c.outputPer1kUsd) ?? '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="space-y-2 pt-1">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Per surface
        </h5>
        <p className="text-xs text-muted-foreground">
          Which tier each surface asks for. Its capability is fixed by the surface itself.
        </p>
        <div className="space-y-1.5">
          {Object.keys(SURFACE_ROUTES).map((surfaceId) => {
            const override = surfaceTiers[surfaceId]
            const base = getSurfaceRoute(surfaceId)
            return (
              <div key={surfaceId} className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">{surfaceId}</span>
                <span className="text-[11px] text-muted-foreground">
                  {base.capability} · default {base.tier}
                </span>
                <select
                  aria-label={`Tier for ${surfaceId}`}
                  value={override ?? ''}
                  onChange={(e) =>
                    setSurfaceTier(surfaceId, e.target.value ? (e.target.value as Tier) : null)
                  }
                  className="ml-auto text-xs border rounded-md px-2 py-1 bg-background text-foreground"
                >
                  <option value="">Inherit default ({base.tier})</option>
                  {TIER_ORDER.map((tier) => (
                    <option key={tier} value={tier}>
                      {TIER_LABELS[tier]}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
