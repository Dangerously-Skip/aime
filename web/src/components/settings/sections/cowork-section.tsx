'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { Textarea } from '@/components/ui/textarea'

export function CoworkSection() {
  const coworkInstructions = useSettingsStore((s) => s.coworkInstructions)
  const setCoworkInstructions = useSettingsStore((s) => s.setCoworkInstructions)

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

    </div>
  )
}
