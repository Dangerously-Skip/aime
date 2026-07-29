'use client'

import { useEffect } from 'react'
import { useSettingsStore, type SettingsStore } from '@/stores/settings-store'

export type SecurityKey =
  | 'blockDangerousCommands'
  | 'blockNetworkCommands'
  | 'restrictToProjectFolder'
  | 'disableBashTool'

/**
 * Whether the server actually refuses this, or merely asks the model to.
 *
 * A FIELD rather than a comment because every one of these was once the wrong
 * one: `disableBashTool` claimed to "completely remove" a tool it left fully
 * working, and the other three described themselves as blocks while appending a
 * sentence to the system prompt. Prose beside the code did not stop that. This
 * declaration is checked by `security-section.enforcement.test.ts`, which drives
 * the real `canUseTool` and fails if an `'enforced'` toggle does not deny.
 *
 * Setting this to 'enforced' is therefore a claim the build will test. If you add
 * a toggle and that test fails, the toggle is guidance: say so here and in the
 * description, or go and enforce it.
 */
export type Enforcement = 'enforced' | 'guidance'

export interface SecurityToggle {
  key: SecurityKey
  setter: keyof Pick<SettingsStore, 'setBlockDangerousCommands' | 'setBlockNetworkCommands' | 'setRestrictToProjectFolder' | 'setDisableBashTool'>
  label: string
  description: string
  enforcement: Enforcement
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
export const SECURITY_TOGGLES: SecurityToggle[] = [
  {
    key: 'blockDangerousCommands',
    enforcement: 'enforced',
    setter: 'setBlockDangerousCommands',
    label: 'Ask before destructive commands',
    description:
      'Pauses and asks you before running rm -rf, sudo, mkfs, dd, chmod 777, force pushes and the like. Errs towards asking. Unattended runs refuse them instead, since nobody is there to ask.',
  },
  {
    key: 'blockNetworkCommands',
    enforcement: 'guidance',
    setter: 'setBlockNetworkCommands',
    label: 'Discourage network commands',
    description:
      'Instructs Claude to refuse curl|sh, wget piping, nc, and SSH tunnels. Allows npm install, git push, and brew. Guidance only — not enforced.',
  },
  {
    key: 'restrictToProjectFolder',
    enforcement: 'enforced',
    setter: 'setRestrictToProjectFolder',
    label: 'Restrict writes to project folder',
    description:
      'The file tools refuse to write outside the working directory (scratch and temp folders excepted). Reading outside is still allowed. Shell commands can still write anywhere — pair this with the setting above.',
  },
  {
    key: 'disableBashTool',
    enforcement: 'enforced',
    setter: 'setDisableBashTool',
    label: 'Disable Bash tool',
    description:
      'Removes Bash, BashOutput and KillShell from the session entirely.',
    warning: 'Prevents Claude from running any terminal commands',
  },
]

/**
 * Mirror the toggles to the server, which is where they are enforced from.
 *
 * The renderer's store is still the UI's source of truth, but `canUseTool` runs
 * server-side and used to be told the values by whichever surface remembered to
 * send them on the chat request — so most paths were ungoverned. The server now
 * owns them; this keeps its copy in step.
 */
async function persistToServer(next: Record<string, boolean>): Promise<void> {
  await fetch('/api/settings/security', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  }).catch(() => {})
}

export function SecuritySection() {
  const store = useSettingsStore()

  // Push the current values once on mount as well as on change: a profile that
  // predates the server-side file would otherwise stay unsynced until the user
  // happened to toggle something.
  useEffect(() => {
    void persistToServer({
      blockDangerousCommands: store.blockDangerousCommands,
      blockNetworkCommands: store.blockNetworkCommands,
      restrictToProjectFolder: store.restrictToProjectFolder,
      disableBashTool: store.disableBashTool,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one sync per mount; per-change syncing happens in the onChange below
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Safety controls</h3>
        <p className="text-xs text-muted-foreground mb-4">
          These settings inject safety rules into Claude&apos;s system prompt and control which tools are available.
        </p>
      </div>

      <div className="space-y-3">
        {SECURITY_TOGGLES.map((toggle) => (
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
              onChange={(e) => {
                store[toggle.setter](e.target.checked)
                void persistToServer({
                  blockDangerousCommands: store.blockDangerousCommands,
                  blockNetworkCommands: store.blockNetworkCommands,
                  restrictToProjectFolder: store.restrictToProjectFolder,
                  disableBashTool: store.disableBashTool,
                  [toggle.key]: e.target.checked,
                })
              }}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{toggle.label}</span>
                {/*
                  Shown, not just declared. The point of the field is that a user
                  can tell at a glance which of these is a boundary and which is
                  a polite request — the distinction they had no way to see, and
                  that three of these four toggles got wrong.
                */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                    toggle.enforcement === 'enforced'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  title={
                    toggle.enforcement === 'enforced'
                      ? 'The server refuses this — not just a request to the model'
                      : 'Guidance in the system prompt; the model can still do it'
                  }
                >
                  {toggle.enforcement}
                </span>
              </div>
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
