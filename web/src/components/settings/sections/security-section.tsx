'use client'

import { useSettingsStore, type SettingsStore } from '@/stores/settings-store'

interface SecurityToggle {
  key: 'blockDangerousCommands' | 'blockNetworkCommands' | 'restrictToProjectFolder' | 'disableBashTool'
  setter: keyof Pick<SettingsStore, 'setBlockDangerousCommands' | 'setBlockNetworkCommands' | 'setRestrictToProjectFolder' | 'setDisableBashTool'>
  label: string
  description: string
  warning?: string
}

/**
 * The wording here is load-bearing — keep it honest when a toggle changes.
 *
 * Each of these is either ENFORCED (the server refuses it: "asks", "refuse",
 * "removes") or ASKED FOR (a line in the system prompt: "Instructs Claude to…").
 * A toggle that overstates its reach is worse than one that admits to being a
 * request, because users calibrate on the label — "Disable Bash tool" once
 * claimed to "completely remove" a tool that in fact kept working.
 */
const toggles: SecurityToggle[] = [
  {
    key: 'blockDangerousCommands',
    setter: 'setBlockDangerousCommands',
    label: 'Ask before destructive commands',
    description:
      'Pauses and asks you before running rm -rf, sudo, mkfs, dd, chmod 777, force pushes and the like. Errs towards asking. Unattended runs refuse them instead, since nobody is there to ask.',
  },
  {
    key: 'blockNetworkCommands',
    setter: 'setBlockNetworkCommands',
    label: 'Discourage network commands',
    description:
      'Instructs Claude to refuse curl|sh, wget piping, nc, and SSH tunnels. Allows npm install, git push, and brew. Guidance only — not enforced.',
  },
  {
    key: 'restrictToProjectFolder',
    setter: 'setRestrictToProjectFolder',
    label: 'Restrict writes to project folder',
    description:
      'The file tools refuse to write outside the working directory (scratch and temp folders excepted). Reading outside is still allowed. Shell commands can still write anywhere — pair this with the setting above.',
  },
  {
    key: 'disableBashTool',
    setter: 'setDisableBashTool',
    label: 'Disable Bash tool',
    description:
      'Removes Bash, BashOutput and KillShell from the session entirely.',
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
