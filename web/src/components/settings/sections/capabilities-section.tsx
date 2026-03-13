'use client'

import { useSettingsStore } from '@/stores/settings-store'
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

  const chatModel = useChatStore((s) => s.model)
  const setChatModel = useChatStore((s) => s.setModel)

  const coworkModel = useCoworkStore((s) => s.model)
  const setCoworkModel = useCoworkStore((s) => s.setModel)

  const codeModel = useCodeStore((s) => s.model)
  const setCodeModel = useCodeStore((s) => s.setModel)

  const browserModel = useBrowserStore((s) => s.model)
  const setBrowserModel = useBrowserStore((s) => s.setModel)

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

  const surfaceStores = [
    { label: 'Chat', model: chatModel, setModel: setChatModel },
    { label: 'Cowork', model: coworkModel, setModel: setCoworkModel },
    { label: 'Code', model: codeModel, setModel: setCodeModel },
    { label: 'Browser', model: browserModel, setModel: setBrowserModel },
  ]

  return (
    <div className="space-y-6">
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
