'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { useCoworkStore } from '@/stores/cowork-store'
import { useElectron } from '@/hooks/use-electron'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FolderOpen } from 'lucide-react'

export function CoworkSection() {
  const coworkInstructions = useSettingsStore((s) => s.coworkInstructions)
  const setCoworkInstructions = useSettingsStore((s) => s.setCoworkInstructions)

  const folder = useCoworkStore((s) => s.folder)
  const setFolder = useCoworkStore((s) => s.setFolder)
  const model = useCoworkStore((s) => s.model)
  const setModel = useCoworkStore((s) => s.setModel)

  const { isElectron, selectFolder } = useElectron()

  const handleSelectFolder = async () => {
    const selected = await selectFolder()
    if (selected) {
      setFolder(selected)
    }
  }

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
        <label className="text-sm font-medium">Default folder path</label>
        <div className="flex items-center gap-2 mt-1.5">
          <Input
            value={folder ?? ''}
            readOnly
            placeholder="No folder selected"
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleSelectFolder}
            disabled={!isElectron}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        {!isElectron && (
          <p className="text-xs text-muted-foreground mt-1">
            (available in desktop app)
          </p>
        )}
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
