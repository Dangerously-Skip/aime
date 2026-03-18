'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chat-store'
import { useCoworkStore } from '@/stores/cowork-store'
import { useCodeStore } from '@/stores/code-store'
import { useBrowserStore } from '@/stores/browser-store'
import { useConversationStore } from '@/stores/conversation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { Download, Trash2, AlertTriangle, RotateCcw } from 'lucide-react'

interface CostBreakdown {
  input: number
  output: number
  total: number
  calls: number
  inputTokens: number
  outputTokens: number
  model: string
}

interface CostData {
  surfaces: Record<string, CostBreakdown>
  total: CostBreakdown
}

export function DataSection() {
  const [costData, setCostData] = useState<CostData | null>(null)
  const [costError, setCostError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/costs')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch costs')
        return res.json()
      })
      .then((data) => setCostData(data))
      .catch((err) => setCostError(err.message))
  }, [])

  const formatUSD = (value: number) => `$${value.toFixed(4)}`

  const handleClearHistory = () => {
    const confirmed = window.confirm(
      'Are you sure you want to clear all conversation history? This action cannot be undone.'
    )
    if (!confirmed) return

    const chatMessages = useChatStore.getState().messages
    for (const chatId of Object.keys(chatMessages)) {
      useChatStore.getState().clearMessages(chatId)
    }

    const coworkMessages = useCoworkStore.getState().messages
    for (const chatId of Object.keys(coworkMessages)) {
      useCoworkStore.getState().clearMessages(chatId)
    }

    const codeMessages = useCodeStore.getState().messages
    for (const chatId of Object.keys(codeMessages)) {
      useCodeStore.getState().clearMessages(chatId)
    }

    const browserMessages = useBrowserStore.getState().messages
    for (const chatId of Object.keys(browserMessages)) {
      useBrowserStore.getState().clearMessages(chatId)
    }

    const conversations = useConversationStore.getState().conversations
    for (const conv of conversations) {
      useConversationStore.getState().removeConversation(conv.id)
    }
  }

  const handleClearAllData = () => {
    const confirmed = window.confirm(
      'WARNING: This will permanently delete ALL application data including settings, conversations, and preferences. This action cannot be undone. Are you absolutely sure?'
    )
    if (!confirmed) return

    localStorage.clear()
    window.location.reload()
  }

  const handleExport = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      settings: useSettingsStore.getState(),
      chat: useChatStore.getState(),
      cowork: useCoworkStore.getState(),
      code: useCodeStore.getState(),
      browser: useBrowserStore.getState(),
      conversations: useConversationStore.getState(),
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'open-claude-cowork-export.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Cost Tracking Summary */}
      <div>
        <label className="text-sm font-medium">Cost tracking</label>
        {costError && (
          <p className="text-xs text-destructive mt-1">{costError}</p>
        )}
        {costData && (
          <div className="mt-1.5 rounded-md border">
            <div className="grid grid-cols-5 gap-2 p-3 text-xs font-medium text-muted-foreground border-b">
              <div>Surface</div>
              <div className="text-right">Input</div>
              <div className="text-right">Output</div>
              <div className="text-right">Total</div>
              <div className="text-right">Calls</div>
            </div>
            {Object.entries(costData.surfaces).map(([name, cost]) => (
              <div
                key={name}
                className="grid grid-cols-5 gap-2 p-3 text-sm border-b last:border-b-0"
              >
                <div className="capitalize">{name}</div>
                <div className="text-right font-mono text-xs">
                  {formatUSD(cost.input)}
                </div>
                <div className="text-right font-mono text-xs">
                  {formatUSD(cost.output)}
                </div>
                <div className="text-right font-mono text-xs">
                  {formatUSD(cost.total)}
                </div>
                <div className="text-right font-mono text-xs">
                  {cost.calls}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-5 gap-2 p-3 text-sm font-medium border-t bg-muted/50">
              <div className="col-span-3">Grand Total</div>
              <div className="text-right font-mono text-xs">
                {formatUSD(costData.total.total)}
              </div>
              <div />
            </div>
          </div>
        )}
        {!costData && !costError && (
          <p className="text-xs text-muted-foreground mt-1">
            Loading cost data...
          </p>
        )}
      </div>

      {/* Export */}
      <div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Export conversations
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          Download all conversations and settings as JSON
        </p>
      </div>

      {/* Restart wizard */}
      <div>
        <Button
          variant="outline"
          onClick={() => {
            useSettingsStore.getState().setOnboardingComplete(false)
            useSettingsStore.getState().setOnboardingSkippedAt(null)
            window.location.reload()
          }}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Restart setup wizard
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          Re-run the first-time setup to change your team or connect apps
        </p>
      </div>

      {/* Destructive Actions */}
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Danger zone
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Clear conversation history</div>
            <p className="text-xs text-muted-foreground">
              Remove all messages from every surface
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleClearHistory}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear history
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Clear all data</div>
            <p className="text-xs text-muted-foreground">
              Permanently delete all settings, conversations, and preferences
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleClearAllData}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear everything
          </Button>
        </div>
      </div>
    </div>
  )
}
