'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { useCoworkStore } from '@/stores/cowork-store'
import { Textarea } from '@/components/ui/textarea'

export function CoworkSection() {
  const coworkInstructions = useSettingsStore((s) => s.coworkInstructions)
  const setCoworkInstructions = useSettingsStore((s) => s.setCoworkInstructions)

  const model = useCoworkStore((s) => s.model)
  const setModel = useCoworkStore((s) => s.setModel)

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm font-medium">Global instructions</label>
        <Textarea
          value={coworkInstructions}
          onChange={(e) => setCoworkInstructions(e.target.value)}
          rows={4}
          className="mt-1.5"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Instructions prepended to all Cowork surface prompts
        </p>
      </div>

      <div>
        <label className="text-sm font-medium">Default model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="sonnet">Sonnet</option>
          <option value="opus">Opus</option>
          <option value="haiku">Haiku</option>
        </select>
      </div>
    </div>
  )
}
