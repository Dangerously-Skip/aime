'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { IMAGE_MODELS, FALLBACK_IMAGE_MODEL, findImageModel } from '@/lib/images/catalog'
import { Badge } from '@/components/ui/badge'

/**
 * Which model generates images.
 *
 * This exists because there was no way to answer that question. The model was a
 * constant in `lib/images/generate.ts` that the only call site never overrode,
 * so every image AIME had ever produced came from one model and Settings had no
 * say — the same shape as the surfaces that shipped PINNED and made the tier
 * grid decorative.
 *
 * It sits under the tier grid rather than in its own section deliberately: the
 * user should have ONE place that answers "which model does what". The tier grid
 * governs agent-loop models, this governs the image capability, and they are the
 * same screen.
 *
 * "Not chosen" is a real state, distinct from the fallback. Showing it is what
 * makes the choice discoverable instead of a default nobody knows they have.
 */
export function ImageModelChooser() {
  const imageModel = useSettingsStore((s) => s.imageModel)
  const setImageModel = useSettingsStore((s) => s.setImageModel)

  const chosen = findImageModel(imageModel)
  const fallback = findImageModel(FALLBACK_IMAGE_MODEL)
  const unset = !imageModel

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Image model</h4>
        {unset && (
          <Badge variant="outline" className="text-[10px]">
            not chosen
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {unset ? (
          <>
            Nothing chosen yet, so images use{' '}
            <span className="font-medium">{fallback?.label ?? FALLBACK_IMAGE_MODEL}</span> — the
            cheapest option. Pick one to make it yours.
          </>
        ) : (
          <>Runs on your OpenRouter credential. Costs are per image, and approximate.</>
        )}
      </p>

      <div className="grid gap-2">
        {IMAGE_MODELS.map((m) => {
          const active = imageModel === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setImageModel(active ? null : m.id)}
              aria-pressed={active}
              className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:bg-muted/40'
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {m.kind}
                  </Badge>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{m.note}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                ~{m.centsPerImage}¢
              </span>
            </button>
          )
        })}
      </div>

      {chosen && (
        <p className="text-xs text-muted-foreground">
          Using <span className="font-medium">{chosen.label}</span>. Click it again to go back to
          the default.
        </p>
      )}
    </div>
  )
}
