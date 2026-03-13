'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { useCodeStore } from '@/stores/code-store'
import { useElectron } from '@/hooks/use-electron'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FolderOpen } from 'lucide-react'
import type { PermissionMode } from '@/stores/code-store'

const permissionOptions: {
  value: PermissionMode
  label: string
  description: string
}[] = [
  {
    value: 'default',
    label: 'Default',
    description: 'Claude asks before making changes',
  },
  {
    value: 'acceptEdits',
    label: 'Accept Edits',
    description: 'Automatically accept file edits',
  },
  {
    value: 'plan',
    label: 'Plan',
    description: 'Claude creates a plan before acting',
  },
  {
    value: 'bypass',
    label: 'Bypass',
    description: 'Accepts all permissions without asking',
  },
]

export function CodeSection() {
  const codeWorktreeLocation = useSettingsStore((s) => s.codeWorktreeLocation)
  const setCodeWorktreeLocation = useSettingsStore((s) => s.setCodeWorktreeLocation)
  const codeBranchPrefix = useSettingsStore((s) => s.codeBranchPrefix)
  const setCodeBranchPrefix = useSettingsStore((s) => s.setCodeBranchPrefix)

  const permissionMode = useCodeStore((s) => s.permissionMode)
  const setPermissionMode = useCodeStore((s) => s.setPermissionMode)
  const folder = useCodeStore((s) => s.folder)
  const setFolder = useCodeStore((s) => s.setFolder)
  const model = useCodeStore((s) => s.model)
  const setModel = useCodeStore((s) => s.setModel)

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
        <label className="text-sm font-medium">Permission mode</label>
        <div className="mt-1.5 space-y-2">
          {permissionOptions.map((option) => (
            <label
              key={option.value}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                permissionMode === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/25'
              }`}
            >
              <input
                type="radio"
                name="permissionMode"
                value={option.value}
                checked={permissionMode === option.value}
                onChange={() => setPermissionMode(option.value)}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
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
        <label className="text-sm font-medium">Worktree location</label>
        <Input
          value={codeWorktreeLocation}
          onChange={(e) => setCodeWorktreeLocation(e.target.value)}
          className="mt-1.5"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Default location for git worktree isolation
        </p>
      </div>

      <div>
        <label className="text-sm font-medium">Branch prefix</label>
        <Input
          value={codeBranchPrefix}
          onChange={(e) => setCodeBranchPrefix(e.target.value)}
          placeholder="e.g. claude/"
          className="mt-1.5"
        />
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
