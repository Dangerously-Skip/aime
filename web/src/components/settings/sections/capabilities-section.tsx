'use client'

import { useSettingsStore } from '@/stores/settings-store'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { detectPlatform, formatAcceleratorForDisplay } from '@/lib/voice/accelerator'
import { useVoiceHotkeyStatus } from '@/hooks/use-voice-input'
import { useChatStore } from '@/stores/chat-store'
import { useCoworkStore } from '@/stores/cowork-store'
import { useCodeStore } from '@/stores/code-store'
import { useBrowserStore } from '@/stores/browser-store'
import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'

interface SurfaceConfig {
  name: string
  allowedTools: string[]
  model: string
  maxTurns: number
  maxBudgetUsd: number
  permissionMode: string
}

export function CapabilitiesSection() {
  const toolAccessMode = useSettingsStore((s) => s.toolAccessMode)
  const setToolAccessMode = useSettingsStore((s) => s.setToolAccessMode)
  const toolProfile = useSettingsStore((s) => s.toolProfile)
  const setToolProfile = useSettingsStore((s) => s.setToolProfile)

  const chatModel = useChatStore((s) => s.model)
  const setChatModel = useChatStore((s) => s.setModel)

  const coworkModel = useCoworkStore((s) => s.model)
  const setCoworkModel = useCoworkStore((s) => s.setModel)

  const codeModel = useCodeStore((s) => s.model)
  const setCodeModel = useCodeStore((s) => s.setModel)

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

  const modelOptions = ['sonnet', 'opus', 'haiku'] as const

  /**
   * Browser is deliberately absent: it has no model of its own. It resolves
   * through `resolveSendRoute` like every other surface, so the tier grid and
   * the user's BYOK providers govern it — which is the whole point of a single
   * chokepoint.
   *
   * The three below are a LEGACY fallback, not the primary control. Each of
   * these surfaces already resolves a route first (`route?.model ?? model`), so
   * this value is only reached when nothing resolves. Folding them into the tier
   * grid the same way is the remaining half of the job.
   */
  const surfaceStores = [
    { label: 'Chat', model: chatModel, setModel: setChatModel },
    { label: 'Cowork', model: coworkModel, setModel: setCoworkModel },
    { label: 'Code', model: codeModel, setModel: setCodeModel },
  ]

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
          <Switch checked={pushToTalkEnabled} onCheckedChange={setPushToTalkEnabled} />
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
            className="h-7 w-56 font-mono text-xs"
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

      {/* Tool Access Mode */}
      <div>
        <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tool Access Mode
        </label>
        <div className="mt-2 inline-flex rounded-lg border border-border bg-muted p-0.5">
          <button
            onClick={() => setToolAccessMode('onDemand')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              toolAccessMode === 'onDemand'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Load when needed
          </button>
          <button
            onClick={() => setToolAccessMode('alwaysLoaded')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              toolAccessMode === 'alwaysLoaded'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Always loaded
          </button>
        </div>
      </div>

      {/* Tool Profile */}
      <div>
        <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tool Profile
        </label>
        <p className="mt-1 text-xs text-muted-foreground">Limits which tools the agent can use across all surfaces.</p>
        <div className="mt-2 inline-flex rounded-lg border border-border bg-muted p-0.5">
          {(['minimal', 'coding', 'full'] as const).map((profile) => (
            <button
              key={profile}
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
          {toolProfile === 'minimal' && 'WebSearch + WebFetch only'}
          {toolProfile === 'coding' && 'Read/Write/Edit/Glob/Grep/Bash + Web tools'}
          {toolProfile === 'full' && 'All surface defaults'}
        </p>
      </div>

      {/* Per-surface Tool Summary */}
      <div>
        <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Surface Configuration
        </label>
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
                  {(surface.allowedTools || []).map((tool) => (
                    <Badge key={tool} variant="secondary">
                      {tool}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Model: {surface.model}</p>
                  <p>Max turns: {surface.maxTurns}</p>
                  <p>Budget: ${surface.maxBudgetUsd?.toFixed(2)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Default Model per Surface */}
      <div>
        <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Default Model per Surface
        </label>
        <div className="mt-2 space-y-3">
          {surfaceStores.map(({ label, model, setModel }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-sm font-medium">{label}</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="text-sm border rounded-md px-2 py-1 bg-background text-foreground"
              >
                {modelOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
