'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { detectPlatform, formatAcceleratorForDisplay } from '@/lib/voice/accelerator'
import { useVoiceHotkeyStatus } from '@/hooks/use-voice-input'
import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { friendlyToolLabels } from './tool-labels'

interface SurfaceConfig {
  name: string
  allowedTools: string[]
  maxTurns: number
  maxBudgetUsd: number
}

export function CapabilitiesSection() {
  const toolProfile = useSettingsStore((s) => s.toolProfile)
  const setToolProfile = useSettingsStore((s) => s.setToolProfile)

  const pushToTalkEnabled = useSettingsStore((s) => s.pushToTalkEnabled)
  const setPushToTalkEnabled = useSettingsStore((s) => s.setPushToTalkEnabled)
  const pushToTalkAccelerator = useSettingsStore((s) => s.pushToTalkAccelerator)
  const setPushToTalkAccelerator = useSettingsStore((s) => s.setPushToTalkAccelerator)

  /** What the OS actually did, as opposed to what the switch says. */
  const hotkey = useVoiceHotkeyStatus()

  // Resolved after mount, not during render: this is a client component that
  // Next server-renders, where the platform is knowable but the renderer's is
  // not. Resolving during render would make the server's HTML and the first
  // client render disagree — a hydration mismatch over a keyboard glyph.
  const [platform, setPlatform] = useState('')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the renderer platform is only readable after mount; see above
    setPlatform(detectPlatform())
  }, [])

  // Uncommitted text in the hotkey field, so a half-typed combination is not
  // rejected on every keystroke.
  const [acceleratorDraft, setAcceleratorDraft] = useState<string | null>(null)
  const [acceleratorError, setAcceleratorError] = useState<string | null>(null)

  function commitAccelerator(raw: string) {
    const verdict = setPushToTalkAccelerator(raw)
    if (verdict.ok) {
      setAcceleratorDraft(null)
      setAcceleratorError(null)
    } else {
      setAcceleratorError(verdict.message)
    }
  }

  const [surfaces, setSurfaces] = useState<SurfaceConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings/surfaces')
      .then((res) => res.json())
      .then((data) => {
        // API returns { surfaces: { chat: {...}, cowork: {...} } }
        const surfaceMap = data.surfaces || data
        const list = Object.entries(surfaceMap).map(([name, config]) => ({
          name,
          ...(config as Omit<SurfaceConfig, 'name'>),
        }))
        setSurfaces(list)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [])

  return (
    <div className="space-y-6">
      {/* Push-to-talk (P4.1) — off by default; enabling claims a system-wide key. */}
      <div className="rounded-lg border p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Dictate with a global hotkey</div>
            <p className="text-xs text-muted-foreground">
              Press{' '}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                {formatAcceleratorForDisplay(pushToTalkAccelerator, platform)}
              </kbd>{' '}
              anywhere to start and stop dictation. Transcribed on this machine; nothing is uploaded.
              While on, no other app can use that combination.
            </p>
          </div>
          <Switch
            checked={pushToTalkEnabled}
            onCheckedChange={setPushToTalkEnabled}
            aria-label="Dictate with a global hotkey"
          />
        </div>

        {/* Editing the combination. Without this the validator was 140 lines
            reachable only from a store action nothing called. */}
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor="push-to-talk-accelerator" className="text-xs text-muted-foreground">
            Shortcut
          </label>
          <Input
            id="push-to-talk-accelerator"
            aria-label="Push-to-talk shortcut"
            className="h-7 min-w-0 flex-1 font-mono text-xs"
            spellCheck={false}
            value={acceleratorDraft ?? pushToTalkAccelerator}
            onChange={(e) => {
              setAcceleratorDraft(e.target.value)
              setAcceleratorError(null)
            }}
            onBlur={(e) => commitAccelerator(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              commitAccelerator(e.currentTarget.value)
            }}
          />
        </div>
        {acceleratorError && (
          <p className="mt-1 text-xs text-destructive">{acceleratorError}</p>
        )}

        {/* A switch that reads ON while no hotkey works is the failure to avoid,
            so registration outcomes are shown here rather than logged. */}
        {pushToTalkEnabled && hotkey.state === 'failed' && (
          <p className="mt-1 text-xs text-destructive">
            {hotkey.message} Dictation by hotkey is off until you choose another combination.
          </p>
        )}
        {pushToTalkEnabled && hotkey.state === 'unavailable' && (
          <p className="mt-1 text-xs text-muted-foreground">
            A global hotkey needs the desktop app — the mic button still works here.
          </p>
        )}
        {pushToTalkEnabled && hotkey.state === 'held' && (
          <p className="mt-1 text-xs text-muted-foreground">
            Registered with the system as{' '}
            <span className="font-mono">{formatAcceleratorForDisplay(hotkey.accelerator, platform)}</span>.
          </p>
        )}
      </div>

      {/* Tool Profile */}
      <div>
        <h4 id="tool-profile-heading" className="text-sm font-medium">
          Tool profile
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">Limits which tools the agent can use across all surfaces.</p>
        <div
          role="group"
          aria-labelledby="tool-profile-heading"
          className="mt-2 inline-flex rounded-lg border border-border bg-muted p-0.5"
        >
          {(['minimal', 'coding', 'full'] as const).map((profile) => (
            <button
              key={profile}
              type="button"
              aria-pressed={toolProfile === profile}
              onClick={() => setToolProfile(profile)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                toolProfile === profile
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {profile}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {toolProfile === 'minimal' && 'Web search and reading web pages only'}
          {toolProfile === 'coding' && 'Files, terminal commands and the web'}
          {toolProfile === 'full' && 'Everything each surface allows'}
        </p>
      </div>

      {/* Per-surface Tool Summary */}
      <div>
        <h4 className="text-sm font-medium">What each surface can do</h4>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {loading ? (
            <p className="text-sm text-muted-foreground col-span-2">
              Loading surfaces...
            </p>
          ) : surfaces.length === 0 ? (
            <p className="text-sm text-muted-foreground col-span-2">
              No surface data available
            </p>
          ) : (
            surfaces.map((surface) => (
              <div
                key={surface.name}
                className="border rounded-lg p-4 bg-card"
              >
                <h4 className="text-sm font-medium capitalize">
                  {surface.name}
                </h4>
                <div className="mt-2 flex flex-wrap gap-1">
                  {friendlyToolLabels(surface.allowedTools || []).map((tool) => (
                    <Badge key={tool} variant="secondary">
                      {tool}
                    </Badge>
                  ))}
                </div>
                {/* No "Model:" line. The surface config's model is only the
                    last-resort fallback; which model a surface runs is decided
                    by the tier grid in Models & API keys, and printing
                    "sonnet" here contradicted it. */}
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Max turns: {surface.maxTurns}</p>
                  <p>Budget: ${surface.maxBudgetUsd?.toFixed(2)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  )
}
