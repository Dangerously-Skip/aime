'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { useCodeStore } from '@/stores/code-store'
import { Input } from '@/components/ui/input'
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

    </div>
  )
}
