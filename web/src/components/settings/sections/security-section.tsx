'use client'

import { useSettingsStore, type SettingsStore } from '@/stores/settings-store'

interface SecurityToggle {
  key: 'blockDangerousCommands' | 'blockNetworkCommands' | 'restrictToProjectFolder' | 'disableBashTool'
  setter: keyof Pick<SettingsStore, 'setBlockDangerousCommands' | 'setBlockNetworkCommands' | 'setRestrictToProjectFolder' | 'setDisableBashTool'>
  label: string
  description: string
  warning?: string
}

const toggles: SecurityToggle[] = [
  {
    key: 'blockDangerousCommands',
    setter: 'setBlockDangerousCommands',
    label: 'Block dangerous commands',
    description:
      'Instructs Claude to refuse rm -rf, sudo, mkfs, dd, chmod 777, and other destructive shell commands.',
  },
  {
    key: 'blockNetworkCommands',
    setter: 'setBlockNetworkCommands',
    label: 'Block network commands',
    description:
      'Instructs Claude to refuse curl|sh, wget piping, nc, and SSH tunnels. Allows npm install, git push, and brew.',
  },
  {
    key: 'restrictToProjectFolder',
    setter: 'setRestrictToProjectFolder',
    label: 'Restrict writes to project folder',
    description:
      'Instructs Claude to only write or delete files within the selected working directory. Reading outside is still allowed.',
  },
  {
    key: 'disableBashTool',
    setter: 'setDisableBashTool',
    label: 'Disable Bash tool',
    description:
      'Completely removes the Bash tool from Claude\'s available tools.',
    warning: 'Prevents Claude from running any terminal commands',
  },
]

export function SecuritySection() {
  const store = useSettingsStore()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Safety controls</h3>
        <p className="text-xs text-muted-foreground mb-4">
          These settings inject safety rules into Claude&apos;s system prompt and control which tools are available.
        </p>
      </div>

      <div className="space-y-3">
        {toggles.map((toggle) => (
          <label
            key={toggle.key}
            className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
              store[toggle.key]
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/25'
            }`}
          >
            <input
              type="checkbox"
              checked={store[toggle.key]}
              onChange={(e) => store[toggle.setter](e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">{toggle.label}</div>
              <div className="text-xs text-muted-foreground">
                {toggle.description}
              </div>
              {toggle.warning && store[toggle.key] && (
                <div className="text-xs text-orange-500 mt-1">
                  {toggle.warning}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
