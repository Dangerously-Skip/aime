'use client'

import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, X, KeyRound } from 'lucide-react'
import { ProviderManager } from './provider-manager'
import { TierGrid } from './tier-grid'

/**
 * Settings → API Access. Inference-provider setup, in this order:
 *
 *  1. The Anthropic API key (the shortest path to a working install)
 *  2. The tier grid (which model fills each tier)
 *  3. ProviderManager (OpenRouter, local Ollama, any OpenAI-compatible endpoint)
 *
 * This used to lead with an org "team" picker that mapped a team to a bundled
 * API key; that concept moved to a separate product, so the key entry is the
 * front door now.
 */

/**
 * Mirror the Anthropic key into the OS-keychain-backed credential store under
 * providerId 'anthropic'. The renderer's localStorage copy is invisible to the
 * server process, and the C5 scheduler runs there — without this mirror,
 * scheduled widget refreshes silently fail for BYOK users. Fire-and-forget:
 * the mirror must never block saving the key locally.
 */
function mirrorKeyToKeychain(key: string | null) {
  const req = key
    ? fetch('/api/models/providers/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'anthropic', values: { apiKey: key } }),
      })
    : fetch('/api/models/providers/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'anthropic' }),
      });
  void req.catch(() => {});
}

export function ConnectorsSection() {
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey)
  const setAnthropicApiKey = useSettingsStore((s) => s.setAnthropicApiKey)

  const [showKey, setShowKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  const isConfigured = !!anthropicApiKey

  function handleSaveKey() {
    const trimmed = keyInput.trim()
    if (trimmed) {
      setAnthropicApiKey(trimmed)
      setKeyInput('')
      mirrorKeyToKeychain(trimmed)
    }
  }

  function handleClearKey() {
    setAnthropicApiKey(null)
    setKeyInput('')
    setShowKey(false)
    mirrorKeyToKeychain(null)
  }

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-6 bg-card space-y-4">
        <div className="flex items-center gap-2">
          <span
            data-testid="anthropic-key-status"
            data-configured={isConfigured ? 'true' : 'false'}
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              isConfigured ? 'bg-green-500' : 'bg-muted-foreground/40'
            }`}
          />
          <h4 className="text-sm font-medium">Anthropic API Key</h4>
          {isConfigured && (
            <span className="ml-auto text-xs text-muted-foreground font-medium">
              Configured
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Claude direct — the simplest way to reach a model. Add other providers
          below.
        </p>

        {isConfigured ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                value={anthropicApiKey ?? ''}
                aria-label="Anthropic API key"
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
                aria-label="Anthropic API key"
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                className="font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveKey()
                }}
              />
              <Button onClick={handleSaveKey} disabled={!keyInput.trim()} size="sm">
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get a key at console.anthropic.com.
            </p>
          </div>
        )}
      </div>

      <TierGrid />

      <ProviderManager />
    </div>
  )
}
