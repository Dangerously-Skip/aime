'use client'

import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Eye, EyeOff, ExternalLink, X } from 'lucide-react'

export function ConnectorsSection() {
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey)
  const setNibGatewayApiKey = useSettingsStore((s) => s.setNibGatewayApiKey)
  const [showKey, setShowKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  const isConfigured = !!nibGatewayApiKey

  function handleSaveKey() {
    const trimmed = keyInput.trim()
    if (trimmed) {
      setNibGatewayApiKey(trimmed)
      setKeyInput('')
      setShowKey(false)
    }
  }

  function handleClearKey() {
    setNibGatewayApiKey(null)
    setKeyInput('')
    setShowKey(false)
  }

  return (
    <div className="space-y-6">
      <div className="border rounded-lg p-6 bg-card">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              isConfigured ? 'bg-green-500' : 'bg-gray-400'
            }`}
          />
          <h4 className="text-sm font-medium">nib AI Studio Gateway</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Connect to nib&apos;s AI gateway for team-based inference. Requires VPN.
        </p>

        {isConfigured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                value={nibGatewayApiKey}
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
              All inference will route through the nib AI Studio gateway.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-..."
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
              Get your API key from the{' '}
              <a
                href="https://ai-studio-frontend.internal.invalid"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                nib AI Studio portal
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
