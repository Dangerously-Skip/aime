'use client'

import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { getTeams, type TeamConfig } from '@/config/teams'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, X, Check, KeyRound } from 'lucide-react'
import { ProviderManager } from './provider-manager'
import { TierGrid } from './tier-grid'

export function ConnectorsSection() {
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey)
  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey)
  const teamId = useSettingsStore((s) => s.teamId)
  const setTeamId = useSettingsStore((s) => s.setTeamId)

  const [teams, setTeams] = useState<TeamConfig[]>([])
  const [showKey, setShowKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  useEffect(() => {
    setTeams(getTeams())
  }, [])

  const hasTeams = teams.length > 0
  const isConfigured = !!anthropicApiKey
  const currentTeam = teams.find((t) => t.id === teamId)

  function handleSelectTeam(team: TeamConfig) {
    setTeamId(team.id)
    setAnthropicApiKey(team.key)
  }

  function handleSaveKey() {
    const trimmed = keyInput.trim()
    if (trimmed) {
      setAnthropicApiKey(trimmed)
      setTeamId(null)
      setKeyInput('')
    }
  }

  function handleClearKey() {
    setAnthropicApiKey(null)
    setTeamId(null)
    setKeyInput('')
    setShowKey(false)
  }

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-6 bg-card space-y-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              isConfigured ? 'bg-green-500' : 'bg-muted-foreground/40'
            }`}
          />
          <h4 className="text-sm font-medium">Anthropic API Key</h4>
          {isConfigured && currentTeam && (
            <span className="ml-auto text-xs text-muted-foreground font-medium">
              {currentTeam.name}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Select your team to configure AI access automatically.
        </p>

        {hasTeams ? (
          <>
            <div className="space-y-2">
              {teams.map((team) => {
                const isSelected = teamId === team.id
                return (
                  <button
                    key={team.id}
                    onClick={() => handleSelectTeam(team)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-border/80 hover:bg-accent/30'
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {team.name.charAt(0)}
                    </div>
                    <span className="flex-1 text-sm font-medium">{team.name}</span>
                    {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                )
              })}
            </div>

            {isConfigured && (
              <button
                onClick={handleClearKey}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                Clear configuration
              </button>
            )}
          </>
        ) : (
          /* Fallback: manual API key entry when teams.json is empty */
          isConfigured ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={anthropicApiKey ?? ''}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClearKey}
                  title="Remove key"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used for Claude inference via the Anthropic API.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  className="font-mono text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveKey()
                  }}
                />
                <Button
                  onClick={handleSaveKey}
                  disabled={!keyInput.trim()}
                  size="sm"
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Contact your team admin to get a configured API key.
              </p>
            </div>
          )
        )}
      </div>

      <TierGrid />

      <ProviderManager />
    </div>
  )
}
